import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePoints, buildLeaderboard, topFive } from '../src/game/scoring.js';
import { cleanNickname, uniqueNickname } from '../src/game/nicknames.js';
import { normalizeRoomCode } from '../src/game/RoomManager.js';
import { GameRoom } from '../src/game/GameRoom.js';

function createFakeIo() {
  const emitted = [];
  return {
    emitted,
    sockets: { sockets: new Map() },
    to(target) {
      return {
        emit(event, payload) {
          emitted.push({ target, event, payload });
        },
      };
    },
  };
}

function createRoom({ durationSec = 30 } = {}) {
  const io = createFakeIo();
  const room = new GameRoom({
    code: '123456',
    hostId: 'host-1',
    hostSocketId: 'host-socket',
    io,
    quiz: {
      _id: 'quiz-1',
      title: 'Test quiz',
      questions: [
        {
          type: 'multiple_choice',
          text: 'Pick one',
          options: ['A', 'B', 'C'],
          correctIndex: 1,
          durationSec,
        },
      ],
    },
  });
  return { room, io };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('calculatePoints rewards fast correct answers', () => {
  const base = { correct: true, startsAt: 1000, durationMs: 20000 };
  assert.equal(calculatePoints({ ...base, receivedAt: 1000 }), 1000);
  assert.equal(calculatePoints({ ...base, receivedAt: 11000 }), 500);
  assert.equal(calculatePoints({ ...base, receivedAt: 21000 }), 0);
  assert.equal(calculatePoints({ ...base, correct: false, receivedAt: 11000 }), 0);
});

test('calculatePoints clamps clock edge cases', () => {
  const base = { correct: true, startsAt: 1000, durationMs: 10000 };
  assert.equal(calculatePoints({ ...base, receivedAt: 999 }), 1000);
  assert.equal(calculatePoints({ ...base, receivedAt: 11000 }), 0);
  assert.equal(calculatePoints({ ...base, receivedAt: Number.NaN }), 0);
  assert.equal(calculatePoints({ ...base, durationMs: 0, receivedAt: 2000 }), 0);
});

test('buildLeaderboard sorts scores and gives unique ranks', () => {
  const players = [
    { id: 'a', nickname: 'A', totalScore: 100, joinOrder: 0 },
    { id: 'b', nickname: 'B', totalScore: 300, joinOrder: 2 },
    { id: 'c', nickname: 'C', totalScore: 300, joinOrder: 1 },
  ];
  const leaderboard = buildLeaderboard(players);
  assert.deepEqual(
    leaderboard.map((entry) => entry.nickname),
    ['C', 'B', 'A'],
  );
  assert.deepEqual(leaderboard.map((entry) => entry.rank), [1, 2, 3]);
  assert.equal(topFive(leaderboard).length, 3);
});

test('nicknames are cleaned, capped and de-duplicated case-insensitively', () => {
  assert.equal(cleanNickname('  Kwame   Mensah  '), 'Kwame Mensah');
  assert.equal(cleanNickname('   '), null);
  assert.equal(cleanNickname('x'.repeat(25)), null);

  const players = [
    { nickname: 'Kwame' },
    { nickname: 'kwame2' },
  ];
  assert.equal(uniqueNickname(players, 'Kwame'), 'Kwame3');
  assert.equal(uniqueNickname(players, 'Ama'), 'Ama');
});

test('de-duplicated 24-character nicknames stay within the cap', () => {
  const long = 'x'.repeat(24);
  const first = uniqueNickname([{ nickname: long }], long);
  assert.equal(first, `${'x'.repeat(23)}2`);
  assert.equal(first.length, 24);

  const second = uniqueNickname([{ nickname: long }, { nickname: first }], long);
  assert.equal(second, `${'x'.repeat(23)}3`);
  assert.equal(second.length, 24);
});

test('room codes are exactly six digits', () => {
  assert.equal(normalizeRoomCode('012345'), '012345');
  assert.equal(normalizeRoomCode(123456), '123456');
  assert.equal(normalizeRoomCode('12345'), null);
  assert.equal(normalizeRoomCode('abcdef'), null);
});

test('host live state tracks eligible players, answers and choice counts', () => {
  const { room, io } = createRoom();
  const ama = room.addPlayer({ nickname: 'Ama', socketId: 'ama-socket' });
  const kofi = room.addPlayer({ nickname: 'Kofi', socketId: 'kofi-socket' });
  room.start();

  let state = room.liveState();
  assert.equal(state.index, 0);
  assert.equal(state.total, 1);
  assert.equal(state.phase, 'question');
  assert.equal(state.correctIndex, 1);
  assert.equal(state.answered, 0);
  assert.equal(state.eligible, 2);
  assert.deepEqual(state.choiceCounts, [0, 0, 0]);
  assert.deepEqual(
    state.players.map((player) => player.status),
    ['thinking', 'thinking'],
  );
  assert.equal(state.players[0].choiceIndex, null);

  assert.equal(
    room.recordAnswer({ playerId: ama.id, questionIndex: 0, choiceIndex: 1 }).accepted,
    true,
  );
  state = room.liveState();
  assert.equal(state.answered, 1);
  assert.deepEqual(state.choiceCounts, [0, 1, 0]);
  assert.equal(state.players[0].status, 'answered');
  assert.equal(state.players[0].choiceIndex, 1);
  assert.equal(state.players[1].status, 'thinking');

  room.markPlayerDisconnected(kofi.id, 'kofi-socket');
  state = room.liveState();
  assert.equal(state.players[1].status, 'offline');

  const hostStates = io.emitted.filter(
    (event) => event.target === 'host-socket' && event.event === 'host:live_state',
  );
  assert.ok(hostStates.length >= 3);
  assert.equal(hostStates.at(-1).payload.players[1].status, 'offline');

  room.destroy();
});

test('pause freezes answers and resume preserves scoring elapsed time', async () => {
  const { room, io } = createRoom({ durationSec: 10 });
  const ama = room.addPlayer({ nickname: 'Ama', socketId: 'ama-socket' });
  const kofi = room.addPlayer({ nickname: 'Kofi', socketId: 'kofi-socket' });
  room.start();

  assert.equal(
    room.recordAnswer({ playerId: ama.id, questionIndex: 0, choiceIndex: 1 }).accepted,
    true,
  );
  const answer = room.currentQuestion.answers.get(ama.id);
  const elapsedBeforePause = answer.receivedAt - room.currentQuestion.startsAt;
  const startsAtBeforePause = room.currentQuestion.startsAt;

  assert.equal(room.pause(), true);
  assert.equal(room.paused, true);
  const pausedEvent = io.emitted.find((event) => event.event === 'game:paused');
  assert.ok(pausedEvent);
  assert.equal(pausedEvent.target, '123456');
  assert.equal(pausedEvent.payload.phase, 'question');
  assert.ok(pausedEvent.payload.remainingMs > 0);
  assert.ok(pausedEvent.payload.remainingMs <= 10_000);

  assert.deepEqual(
    room.recordAnswer({ playerId: kofi.id, questionIndex: 0, choiceIndex: 1 }),
    { accepted: false, reason: 'GAME_PAUSED' },
  );

  await sleep(30);
  assert.equal(room.resume(), true);
  assert.equal(room.paused, false);
  assert.ok(room.currentQuestion.startsAt > startsAtBeforePause);
  assert.equal(
    room.currentQuestion.answers.get(ama.id).receivedAt - room.currentQuestion.startsAt,
    elapsedBeforePause,
  );

  const resumedEvent = io.emitted.find((event) => event.event === 'game:resumed');
  assert.ok(resumedEvent);
  assert.equal(resumedEvent.payload.index, 0);
  assert.equal(resumedEvent.payload.phase, 'question');
  assert.equal(resumedEvent.payload.startsAt, room.currentQuestion.startsAt);
  assert.equal(resumedEvent.payload.durationMs, 10_000);
  assert.ok(resumedEvent.payload.remainingMs > 0);

  room.endGame();
  room.destroy();
});
