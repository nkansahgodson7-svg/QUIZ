import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../src/game/GameRoom.js';
import { SERVER_EVENTS } from '../src/game/events.js';
import { calculatePoints, buildLeaderboard, topFive } from '../src/game/scoring.js';
import { cleanNickname, uniqueNickname } from '../src/game/nicknames.js';
import { normalizeRoomCode } from '../src/game/RoomManager.js';

function makeRoomHarness(questions, { revealMs = 50 } = {}) {
  const hostEvents = [];
  const playerSockets = new Map();
  const io = {
    to() {
      return {
        emit(event, payload) {
          hostEvents.push({ event, payload });
        },
      };
    },
    sockets: { sockets: playerSockets },
  };

  const room = new GameRoom({
    code: '123456',
    hostId: 'host-1',
    hostSocketId: 'host-socket',
    quiz: { id: 'quiz-1', title: 'Test quiz', questions },
    io,
    revealMs,
  });

  function addPlayer(nickname, socketId) {
    const events = [];
    playerSockets.set(socketId, {
      emit(event, payload) {
        events.push({ event, payload });
      },
    });
    const player = room.addPlayer({ nickname, socketId });
    return { player, events };
  }

  return { room, hostEvents, addPlayer };
}

function latestHostEvent(hostEvents, event) {
  return hostEvents.filter((entry) => entry.event === event).at(-1)?.payload;
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

test('host question and live state carry the answer key; player payloads do not', (t) => {
  const harness = makeRoomHarness([
    {
      type: 'multiple_choice',
      text: 'Pick the correct answer',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 2,
      durationSec: 30,
    },
  ]);
  t.after(() => harness.room.destroy());

  const ama = harness.addPlayer('Ama', 'socket-ama');
  const kwame = harness.addPlayer('Kwame', 'socket-kwame');
  harness.room.start();

  const hostQuestion = latestHostEvent(harness.hostEvents, SERVER_EVENTS.GAME_QUESTION);
  assert.equal(hostQuestion.correctIndex, 2);
  assert.equal(hostQuestion.myChoiceIndex, null);

  for (const player of [ama, kwame]) {
    const question = player.events.find(
      (entry) => entry.event === SERVER_EVENTS.GAME_QUESTION,
    ).payload;
    assert.equal('correctIndex' in question, false);
    assert.equal('choiceCounts' in question, false);
  }

  const initial = latestHostEvent(harness.hostEvents, SERVER_EVENTS.GAME_ANSWER_COUNT);
  assert.equal(initial.index, 0);
  assert.equal(initial.answered, 0);
  assert.equal(initial.total, 2);
  assert.deepEqual(initial.choiceCounts, [0, 0, 0, 0]);
  assert.deepEqual(
    initial.players.map((player) => [
      player.nickname,
      player.answered,
      player.choiceIndex,
      player.connected,
    ]),
    [
      ['Ama', false, null, true],
      ['Kwame', false, null, true],
    ],
  );

  harness.room.recordAnswer({
    playerId: ama.player.id,
    questionIndex: 0,
    choiceIndex: 2,
  });
  let live = latestHostEvent(harness.hostEvents, SERVER_EVENTS.GAME_ANSWER_COUNT);
  assert.equal(live.answered, 1);
  assert.deepEqual(live.choiceCounts, [0, 0, 1, 0]);
  assert.equal(
    live.players.find((player) => player.playerId === ama.player.id).choiceIndex,
    2,
  );

  harness.room.recordAnswer({
    playerId: ama.player.id,
    questionIndex: 0,
    choiceIndex: 1,
  });
  live = latestHostEvent(harness.hostEvents, SERVER_EVENTS.GAME_ANSWER_COUNT);
  assert.equal(live.answered, 1);
  assert.deepEqual(live.choiceCounts, [0, 1, 0, 0]);
  assert.equal(
    live.players.find((player) => player.playerId === ama.player.id).choiceIndex,
    1,
  );

  harness.room.markPlayerDisconnected(kwame.player.id, 'socket-kwame');
  harness.room.emitLiveState();
  live = latestHostEvent(harness.hostEvents, SERVER_EVENTS.GAME_ANSWER_COUNT);
  assert.equal(
    live.players.find((player) => player.playerId === kwame.player.id).connected,
    false,
  );

  harness.room.endQuestion();

  const standings = latestHostEvent(harness.hostEvents, SERVER_EVENTS.HOST_STANDINGS);
  assert.equal(standings.index, 0);
  assert.equal(standings.leaderboard.length, 2);

  const result = ama.events.find(
    (entry) => entry.event === SERVER_EVENTS.QUESTION_RESULT,
  ).payload;
  assert.equal(result.correctIndex, 2);
  assert.equal('choiceCounts' in result, false);

  for (const player of [ama, kwame]) {
    assert.equal(
      player.events.some((entry) => entry.event === SERVER_EVENTS.GAME_ANSWER_COUNT),
      false,
    );
    assert.equal(
      player.events.some((entry) => entry.event === SERVER_EVENTS.HOST_STANDINGS),
      false,
    );
  }
});

test('host controls end the active question early and end the match', (t) => {
  const harness = makeRoomHarness(
    [
      {
        type: 'multiple_choice',
        text: 'First question',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        durationSec: 30,
      },
      {
        type: 'multiple_choice',
        text: 'Second question',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 1,
        durationSec: 30,
      },
    ],
    { revealMs: 10 },
  );
  t.after(() => harness.room.destroy());

  const ama = harness.addPlayer('Ama', 'socket-ama');
  harness.room.start();
  harness.room.recordAnswer({
    playerId: ama.player.id,
    questionIndex: 0,
    choiceIndex: 0,
  });

  harness.room.endQuestion();
  assert.equal(harness.room.state, 'reveal');

  const result = ama.events.find(
    (entry) => entry.event === SERVER_EVENTS.QUESTION_RESULT,
  ).payload;
  assert.ok(result.points > 0);
  const standings = latestHostEvent(harness.hostEvents, SERVER_EVENTS.HOST_STANDINGS);
  assert.equal(standings.index, 0);
  assert.equal(standings.leaderboard[0].playerId, ama.player.id);

  harness.room.endGame();
  assert.equal(harness.room.state, 'ended');
  assert.equal(harness.room.currentQuestion, null);

  const hostEnded = latestHostEvent(harness.hostEvents, SERVER_EVENTS.GAME_ENDED);
  assert.equal(hostEnded.leaderboard.length, 1);
  const playerEnded = ama.events.find(
    (entry) => entry.event === SERVER_EVENTS.GAME_ENDED,
  ).payload;
  assert.equal(playerEnded.yourRank, 1);
  assert.equal(playerEnded.yourScore, result.totalScore);

  assert.throws(() => harness.room.endQuestion(), (error) => error.code === 'GAME_ENDED');
  assert.throws(() => harness.room.endGame(), (error) => error.code === 'GAME_ENDED');
});
