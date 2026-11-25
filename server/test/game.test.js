import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePoints, buildLeaderboard, topFive } from '../src/game/scoring.js';
import { cleanNickname, uniqueNickname } from '../src/game/nicknames.js';
import { normalizeRoomCode } from '../src/game/RoomManager.js';

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
