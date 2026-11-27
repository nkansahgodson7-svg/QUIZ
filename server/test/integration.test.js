import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { io as ioClient } from 'socket.io-client';
import { createQuizServer } from '../src/server.js';

let server;
let baseUrl;
let port;
let tmpDir;
let dbPath;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-server-test-'));
  dbPath = path.join(tmpDir, 'data', 'quiz.db');

  const clientDir = path.join(tmpDir, 'client-dist');
  fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(clientDir, 'index.html'),
    '<!doctype html><html><body><div id="root">quiz spa</div></body></html>',
  );
  fs.writeFileSync(path.join(clientDir, 'assets', 'app.js'), 'console.log("quiz");\n');

  server = createQuizServer({ revealMs: 50, dbPath, clientDir });
  await new Promise((resolve, reject) => {
    server.httpServer.once('error', reject);
    server.httpServer.listen(0, '0.0.0.0', resolve);
  });

  port = server.httpServer.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(urlPath, { method = 'GET', body, base = baseUrl } = {}) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: response.status, data };
}

async function createQuiz(questions, title = 'Test quiz') {
  const result = await request('/api/quizzes', {
    method: 'POST',
    body: { title, questions },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.quiz;
}

function connectSocket(base = baseUrl) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(base, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 10_000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timed out connecting socket'));
    }, 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Socket connect_error: ${error.message}`));
    });
  });
}

function makeInbox(socket) {
  const queues = new Map();
  const waiters = new Map();

  function pump(event) {
    const queue = queues.get(event) || [];
    const pending = waiters.get(event) || [];

    for (let index = 0; index < pending.length;) {
      const waiter = pending[index];
      const matchIndex = queue.findIndex(waiter.predicate);
      if (matchIndex === -1) {
        index += 1;
        continue;
      }

      const [payload] = queue.splice(matchIndex, 1);
      pending.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(payload);
    }
  }

  socket.onAny((event, payload) => {
    const queue = queues.get(event) || [];
    queue.push(payload);
    queues.set(event, queue);
    pump(event);
  });

  return {
    take(event, { predicate = () => true, timeoutMs = 5000, label = event } = {}) {
      const queue = queues.get(event) || [];
      const matchIndex = queue.findIndex(predicate);
      if (matchIndex !== -1) {
        const [payload] = queue.splice(matchIndex, 1);
        return Promise.resolve(payload);
      }

      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const pending = waiters.get(event) || [];
          const index = pending.indexOf(waiter);
          if (index !== -1) pending.splice(index, 1);
          reject(new Error(`Timed out waiting for ${label}`));
        }, timeoutMs);

        const pending = waiters.get(event) || [];
        pending.push(waiter);
        waiters.set(event, pending);
      });
    },
    queued(event) {
      return [...(queues.get(event) || [])];
    },
  };
}

async function joinPlayer(code, nickname, base = baseUrl) {
  const socket = await connectSocket(base);
  const inbox = makeInbox(socket);
  const joinedPromise = inbox.take('player:joined', {
    timeoutMs: 5000,
    label: 'player:joined',
  });
  socket.emit('player:join', { code, nickname });
  const joined = await joinedPromise;
  return { socket, inbox, joined };
}

async function createHostRoom(quizId, base = baseUrl) {
  const socket = await connectSocket(base);
  const inbox = makeInbox(socket);
  const createdPromise = inbox.take('room:created', { timeoutMs: 5000 });
  socket.emit('host:create_room', { quizId });
  const { code } = await createdPromise;
  return { socket, inbox, code };
}

async function waitUntil(check, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForSession(code) {
  let found = null;
  await waitUntil(
    async () => {
      const result = await request('/api/sessions');
      assert.equal(result.status, 200);
      found = result.data.sessions.find((session) => session.code === code);
      return Boolean(found);
    },
    5000,
    'session to be saved',
  );
  const detail = await request(`/api/sessions/${found.id}`);
  assert.equal(detail.status, 200);
  return detail.data.session;
}

function closeSockets(...sockets) {
  for (const socket of sockets) {
    if (socket) socket.disconnect();
  }
}

test('REST: SQLite quiz CRUD, server info, static client and SPA fallback', async () => {
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.db, 'connected');

  const info = await request('/api/server-info');
  assert.equal(info.status, 200);
  assert.equal(info.data.port, port);
  assert.match(info.data.lanUrl, new RegExp(`^http://[^:]+:${port}$`));

  const invalidQuiz = await request('/api/quizzes', {
    method: 'POST',
    body: { title: 'Broken', questions: [{ type: 'multiple_choice', text: 'No options' }] },
  });
  assert.equal(invalidQuiz.status, 400);
  assert.equal(invalidQuiz.data.code, 'VALIDATION_ERROR');

  const questions = [
    {
      type: 'multiple_choice',
      text: 'Capital of Ghana?',
      options: ['Accra', 'Lagos', 'Lome'],
      correctIndex: 0,
      durationSec: 15,
    },
    {
      type: 'true_false',
      text: 'The sky is blue.',
      options: ['Yes', 'No'],
      correctIndex: 0,
    },
  ];
  const created = await request('/api/quizzes', {
    method: 'POST',
    body: { title: 'Geography', questions },
  });
  assert.equal(created.status, 201);
  const quiz = created.data.quiz;
  assert.ok(quiz.id);
  assert.ok(quiz.createdAt);
  assert.ok(quiz.updatedAt);
  assert.equal(quiz.questions.length, 2);
  assert.equal(quiz.questions[0].durationSec, 15);
  assert.deepEqual(quiz.questions[1].options, ['True', 'False']);
  assert.equal(quiz.questions[1].durationSec, 20);

  const raw = new DatabaseSync(dbPath);
  const row = raw.prepare('SELECT title, questions_json FROM quizzes WHERE id = ?').get(quiz.id);
  assert.equal(row.title, 'Geography');
  assert.equal(JSON.parse(row.questions_json).length, 2);
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((entry) => entry.name);
  assert.ok(tables.includes('quizzes'));
  assert.ok(tables.includes('sessions'));
  raw.close();

  const list = await request('/api/quizzes');
  assert.equal(list.status, 200);
  assert.equal(list.data.quizzes.length, 1);

  const loaded = await request(`/api/quizzes/${quiz.id}`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.data.quiz.title, 'Geography');

  const updated = await request(`/api/quizzes/${quiz.id}`, {
    method: 'PUT',
    body: { title: 'Geography v2', questions },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.quiz.title, 'Geography v2');

  const missing = await request('/api/quizzes/not-a-real-id');
  assert.equal(missing.status, 404);
  assert.equal(missing.data.code, 'QUIZ_NOT_FOUND');

  const rootResponse = await fetch(`${baseUrl}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(await rootResponse.text(), /quiz spa/);

  const spaResponse = await fetch(`${baseUrl}/host`);
  assert.equal(spaResponse.status, 200);
  assert.match(await spaResponse.text(), /quiz spa/);

  const assetResponse = await fetch(`${baseUrl}/assets/app.js`);
  assert.equal(assetResponse.status, 200);
  assert.match(await assetResponse.text(), /console\.log/);

  const apiNotFound = await request('/api/not-a-route');
  assert.equal(apiNotFound.status, 404);
  assert.equal(apiNotFound.data.code, 'NOT_FOUND');

  const removed = await request(`/api/quizzes/${quiz.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.ok, true);

  const gone = await request(`/api/quizzes/${quiz.id}`);
  assert.equal(gone.status, 404);
});

test('game flow: join, start, answer changes, scoring, auto-advance, saved session', { timeout: 30_000 }, async () => {
  const quiz = await createQuiz([
    {
      type: 'multiple_choice',
      text: 'Pick the correct answer',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 3,
      durationSec: 2,
    },
    {
      type: 'true_false',
      text: 'A triangle has three sides.',
      options: ['True', 'False'],
      correctIndex: 0,
      durationSec: 2,
    },
  ]);

  const hostRoom = await createHostRoom(quiz.id);
  const hostSocket = hostRoom.socket;
  const hostInbox = hostRoom.inbox;
  const code = hostRoom.code;

  const answerCounts = [];
  hostSocket.on('game:answer_count', (payload) => answerCounts.push(payload));

  const playerOne = await joinPlayer(code, 'Kwame');
  const playerTwo = await joinPlayer(code, 'Kwame');
  assert.equal(playerOne.joined.nickname, 'Kwame');
  assert.equal(playerTwo.joined.nickname, 'Kwame2');
  assert.notEqual(playerOne.joined.playerToken, playerTwo.joined.playerToken);

  const lobby = await hostInbox.take('lobby:update', {
    predicate: (payload) => payload.playerCount === 2,
  });
  assert.equal(lobby.playerCount, 2);

  hostSocket.emit('host:start', { code });

  const [hostQ1, p1Q1, p2Q1] = await Promise.all([
    hostInbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
    playerOne.inbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
    playerTwo.inbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
  ]);
  assert.equal(hostQ1.startsAt, p1Q1.startsAt);
  assert.equal(p1Q1.startsAt, p2Q1.startsAt);
  assert.equal(p1Q1.durationMs, 2000);
  assert.equal(p1Q1.total, 2);
  assert.equal(hostQ1.myChoiceIndex, null);
  assert.equal(p1Q1.myChoiceIndex, null);
  assert.equal(p2Q1.myChoiceIndex, null);

  playerTwo.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 3 });
  playerOne.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 0 });
  await sleep(300);
  playerOne.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 3 });

  await waitUntil(
    () => answerCounts.some((count) => count.index === 0 && count.answered === 2 && count.total === 2),
    3000,
    'host answer count to reach 2/2',
  );

  const [p1R1, p2R1] = await Promise.all([
    playerOne.inbox.take('question:result', { predicate: (result) => result.index === 0 }),
    playerTwo.inbox.take('question:result', { predicate: (result) => result.index === 0 }),
  ]);
  assert.equal(p1R1.points > 0, true);
  assert.equal(p2R1.points > 0, true);
  assert.ok(p1R1.points < p2R1.points, 'last answer at 300ms should score less than a fast answer');
  assert.equal(p2R1.rank, 1);
  assert.equal(p1R1.rank, 2);
  assert.equal(p1R1.top5.length, 2);

  const [p1Q2, p2Q2] = await Promise.all([
    playerOne.inbox.take('game:question', { predicate: (payload) => payload.index === 1 }),
    playerTwo.inbox.take('game:question', { predicate: (payload) => payload.index === 1 }),
  ]);
  assert.equal(p2Q2.type, 'true_false');
  assert.equal(p1Q2.startsAt, p2Q2.startsAt);

  playerOne.socket.emit('player:answer', { code, questionIndex: 1, choiceIndex: 0 });

  const [p1R2, p2R2] = await Promise.all([
    playerOne.inbox.take('question:result', { predicate: (result) => result.index === 1 }),
    playerTwo.inbox.take('question:result', { predicate: (result) => result.index === 1 }),
  ]);
  assert.equal(p2R2.points, 0);
  assert.equal(p1R2.points > 0, true);
  assert.ok(p1R2.totalScore > p2R2.totalScore);
  assert.equal(p1R2.rank, 1);
  assert.equal(p2R2.rank, 2);

  const [hostEnded, p1Ended, p2Ended] = await Promise.all([
    hostInbox.take('game:ended', { timeoutMs: 5000 }),
    playerOne.inbox.take('game:ended', { timeoutMs: 5000 }),
    playerTwo.inbox.take('game:ended', { timeoutMs: 5000 }),
  ]);

  assert.equal(p1Ended.yourRank, 1);
  assert.equal(p1Ended.yourScore, p1R2.totalScore);
  assert.equal(p2Ended.yourRank, 2);
  assert.equal(p2Ended.yourScore, p2R2.totalScore);
  assert.equal(p1Ended.top5.length, 2);
  assert.equal(hostEnded.leaderboard.length, 2);
  assert.equal(hostEnded.leaderboard[0].nickname, 'Kwame');
  assert.equal(hostEnded.leaderboard[0].totalScore, p1R2.totalScore);

  const saved = await waitForSession(code);
  assert.equal(saved.code, code);
  assert.equal(saved.quizTitle, 'Test quiz');
  assert.equal(saved.players.length, 2);
  assert.ok(saved.startedAt);
  assert.ok(saved.endedAt);

  const listed = await request('/api/sessions');
  assert.equal(listed.status, 200);
  const listedSession = listed.data.sessions.find((session) => session.code === code);
  assert.equal(listedSession.quizTitle, 'Test quiz');
  assert.equal(listedSession.playerCount, 2);

  const savedP1 = saved.players.find((player) => player.nickname === 'Kwame');
  const savedP2 = saved.players.find((player) => player.nickname === 'Kwame2');
  assert.equal(savedP1.answers.length, 2);
  assert.equal(savedP1.answers[0].choiceIndex, 3);
  assert.equal(savedP1.answers[0].correct, true);
  assert.equal(savedP1.answers[0].points, p1R1.points);
  assert.equal(savedP1.answers[1].choiceIndex, 0);
  assert.equal(savedP2.answers[1].choiceIndex, null);
  assert.equal(savedP2.answers[1].points, 0);

  closeSockets(hostSocket, playerOne.socket, playerTwo.socket);
});

test('host monitor: live state, standings, early finish controls, hidden answer key', { timeout: 30_000 }, async () => {
  const quiz = await createQuiz([
    {
      type: 'multiple_choice',
      text: 'Question one',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 1,
      durationSec: 30,
    },
    {
      type: 'multiple_choice',
      text: 'Question two',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 2,
      durationSec: 30,
    },
  ]);

  const hostRoom = await createHostRoom(quiz.id);
  const hostSocket = hostRoom.socket;
  const hostInbox = hostRoom.inbox;
  const code = hostRoom.code;

  const playerOne = await joinPlayer(code, 'Ama');
  const playerTwo = await joinPlayer(code, 'Kwame');
  const playerOneEvents = [];
  const playerTwoEvents = [];
  playerOne.socket.onAny((event, payload) => playerOneEvents.push({ event, payload }));
  playerTwo.socket.onAny((event, payload) => playerTwoEvents.push({ event, payload }));

  hostSocket.emit('host:start', { code });

  const [hostQ1, p1Q1, p2Q1] = await Promise.all([
    hostInbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
    playerOne.inbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
    playerTwo.inbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
  ]);
  assert.equal(hostQ1.correctIndex, 1);
  for (const question of [p1Q1, p2Q1]) {
    assert.equal('correctIndex' in question, false);
    assert.equal('choiceCounts' in question, false);
  }

  const initialLive = await hostInbox.take('game:answer_count', {
    predicate: (state) => state.index === 0 && state.answered === 0 && state.players.length === 2,
  });
  assert.equal(initialLive.total, 2);
  assert.deepEqual(initialLive.choiceCounts, [0, 0, 0, 0]);
  assert.deepEqual(
    initialLive.players.find((player) => player.playerId === playerOne.joined.playerId),
    {
      playerId: playerOne.joined.playerId,
      nickname: 'Ama',
      answered: false,
      choiceIndex: null,
      connected: true,
    },
  );

  playerOne.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 1 });
  const liveAfterP1 = await hostInbox.take('game:answer_count', {
    predicate: (state) => state.index === 0 && state.answered === 1,
  });
  assert.deepEqual(liveAfterP1.choiceCounts, [0, 1, 0, 0]);
  assert.equal(
    liveAfterP1.players.find((player) => player.playerId === playerOne.joined.playerId).choiceIndex,
    1,
  );

  playerTwo.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 3 });
  const liveAfterP2 = await hostInbox.take('game:answer_count', {
    predicate: (state) => state.index === 0 && state.answered === 2,
  });
  assert.deepEqual(liveAfterP2.choiceCounts, [0, 1, 0, 1]);

  playerOne.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 0 });
  const liveAfterChange = await hostInbox.take('game:answer_count', {
    predicate: (state) => state.index === 0 && state.choiceCounts[0] === 1,
  });
  assert.equal(liveAfterChange.answered, 2);
  assert.deepEqual(liveAfterChange.choiceCounts, [1, 0, 0, 1]);

  playerOne.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 1 });
  await hostInbox.take('game:answer_count', {
    predicate: (state) => (
      state.index === 0
      && state.answered === 2
      && state.choiceCounts[0] === 0
      && state.choiceCounts[1] === 1
    ),
  });

  const late = await joinPlayer(code, 'Late');
  const lateQuestion = await late.inbox.take('game:question', {
    predicate: (payload) => payload.index === 0,
  });
  assert.equal('correctIndex' in lateQuestion, false);
  assert.equal(lateQuestion.myChoiceIndex, null);

  const liveAfterJoin = await hostInbox.take('game:answer_count', {
    predicate: (state) => state.index === 0 && state.players.length === 3,
  });
  assert.equal(liveAfterJoin.answered, 2);
  assert.equal(liveAfterJoin.total, 2);
  assert.equal(
    liveAfterJoin.players.find((player) => player.playerId === late.joined.playerId).connected,
    true,
  );

  late.socket.disconnect();
  const liveAfterDisconnect = await hostInbox.take('game:answer_count', {
    predicate: (state) => (
      state.index === 0
      && state.players.some(
        (player) => player.playerId === late.joined.playerId && !player.connected,
      )
    ),
  });
  assert.equal(liveAfterDisconnect.answered, 2);

  hostSocket.emit('host:end_question', { code });
  const [hostStandings, p1R1, p2R1] = await Promise.all([
    hostInbox.take('host:standings', { predicate: (standings) => standings.index === 0 }),
    playerOne.inbox.take('question:result', { predicate: (result) => result.index === 0 }),
    playerTwo.inbox.take('question:result', { predicate: (result) => result.index === 0 }),
  ]);
  assert.equal(hostStandings.leaderboard.length, 3);
  assert.equal(hostStandings.leaderboard[0].playerId, playerOne.joined.playerId);
  assert.equal(p1R1.points > 0, true);
  assert.equal(p2R1.points, 0);
  assert.equal(p1R1.rank, 1);
  assert.equal(p2R1.rank, 2);

  const [hostQ2, p1Q2, p2Q2] = await Promise.all([
    hostInbox.take('game:question', { predicate: (payload) => payload.index === 1 }),
    playerOne.inbox.take('game:question', { predicate: (payload) => payload.index === 1 }),
    playerTwo.inbox.take('game:question', { predicate: (payload) => payload.index === 1 }),
  ]);
  assert.equal(hostQ2.correctIndex, 2);
  for (const question of [p1Q2, p2Q2]) {
    assert.equal('correctIndex' in question, false);
    assert.equal('choiceCounts' in question, false);
  }

  const liveQ2 = await hostInbox.take('game:answer_count', {
    predicate: (state) => state.index === 1 && state.answered === 0,
  });
  assert.equal(liveQ2.total, 3);

  hostSocket.emit('host:end_game', { code });
  const [hostEnded, p1Ended, p2Ended] = await Promise.all([
    hostInbox.take('game:ended'),
    playerOne.inbox.take('game:ended'),
    playerTwo.inbox.take('game:ended'),
  ]);
  assert.equal(hostEnded.leaderboard.length, 3);
  assert.equal(p1Ended.yourRank, 1);
  assert.equal(p1Ended.yourScore, p1R1.totalScore);
  assert.equal(p2Ended.yourRank, 2);
  assert.equal(p2Ended.yourScore, p2R1.totalScore);

  const saved = await waitForSession(code);
  assert.equal(saved.players.length, 3);
  assert.equal(saved.players.find((player) => player.nickname === 'Late').totalScore, 0);

  for (const [label, events] of [
    ['player one', playerOneEvents],
    ['player two', playerTwoEvents],
  ]) {
    assert.equal(
      events.some((entry) => entry.event === 'host:standings'),
      false,
      `${label} must not receive host standings`,
    );
    assert.equal(
      events.some((entry) => entry.event === 'game:answer_count'),
      false,
      `${label} must not receive host live state`,
    );
    for (const entry of events) {
      if (entry.payload && typeof entry.payload === 'object') {
        assert.equal(
          'choiceCounts' in entry.payload,
          false,
          `${label} must not receive choiceCounts on ${entry.event}`,
        );
      }
      if (entry.event === 'game:question') {
        assert.equal(
          'correctIndex' in entry.payload,
          false,
          `${label} must not receive the answer key before the reveal`,
        );
      }
    }
  }

  closeSockets(hostSocket, playerOne.socket, playerTwo.socket);
});

test('rejoin keeps score; late joiner starts scoring on the next question', { timeout: 30_000 }, async () => {
  const quiz = await createQuiz([
    {
      type: 'multiple_choice',
      text: 'First question',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 1,
      durationSec: 4,
    },
    {
      type: 'multiple_choice',
      text: 'Second question',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 2,
      durationSec: 4,
    },
  ]);

  const hostRoom = await createHostRoom(quiz.id);
  const code = hostRoom.code;
  const zoe = await joinPlayer(code, 'Zoe');
  const answerCounts = [];
  hostRoom.socket.on('game:answer_count', (payload) => answerCounts.push(payload));

  hostRoom.socket.emit('host:start', { code });
  await zoe.inbox.take('game:question', { predicate: (payload) => payload.index === 0 });
  zoe.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 1 });
  await waitUntil(
    () => answerCounts.some((count) => count.index === 0 && count.answered === 1),
    2000,
    'server to receive Zoe\'s answer before disconnect',
  );

  zoe.socket.disconnect();
  await sleep(100);

  const rejoinSocket = await connectSocket();
  const rejoinInbox = makeInbox(rejoinSocket);
  const rejoinedPromise = rejoinInbox.take('player:joined', { timeoutMs: 5000 });
  rejoinSocket.emit('player:rejoin', {
    code,
    playerToken: zoe.joined.playerToken,
  });
  const rejoined = await rejoinedPromise;
  assert.equal(rejoined.playerId, zoe.joined.playerId);
  assert.equal(rejoined.nickname, 'Zoe');
  assert.equal(rejoined.playerToken, zoe.joined.playerToken);

  const reconnectQuestion = await rejoinInbox.take('game:question', {
    predicate: (payload) => payload.index === 0,
  });
  assert.equal(reconnectQuestion.index, 0);
  assert.equal(reconnectQuestion.total, 2);
  assert.equal(reconnectQuestion.myChoiceIndex, 1);

  const leo = await joinPlayer(code, 'Leo');
  const leoQuestion = await leo.inbox.take('game:question', {
    predicate: (payload) => payload.index === 0,
  });
  assert.equal(leoQuestion.index, 0);
  assert.equal(leoQuestion.myChoiceIndex, null);

  leo.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 1 });
  const notEligible = await leo.inbox.take('error', { timeoutMs: 3000 });
  assert.equal(notEligible.code, 'NOT_ELIGIBLE');

  const [zoeR1, leoR1] = await Promise.all([
    rejoinInbox.take('question:result', { predicate: (result) => result.index === 0 }),
    leo.inbox.take('question:result', { predicate: (result) => result.index === 0 }),
  ]);
  assert.ok(zoeR1.points > 0, 'score from the answer before disconnecting should count');
  assert.equal(leoR1.points, 0);

  const [zoeQ2, leoQ2] = await Promise.all([
    rejoinInbox.take('game:question', { predicate: (payload) => payload.index === 1 }),
    leo.inbox.take('game:question', { predicate: (payload) => payload.index === 1 }),
  ]);
  assert.equal(zoeQ2.startsAt, leoQ2.startsAt);

  rejoinSocket.emit('player:answer', { code, questionIndex: 1, choiceIndex: 2 });
  leo.socket.emit('player:answer', { code, questionIndex: 1, choiceIndex: 2 });

  const [zoeR2, leoR2] = await Promise.all([
    rejoinInbox.take('question:result', { predicate: (result) => result.index === 1 }),
    leo.inbox.take('question:result', { predicate: (result) => result.index === 1 }),
  ]);
  assert.ok(zoeR2.points > 0);
  assert.ok(leoR2.points > 0, 'late joiner should score from the next question');
  assert.equal(leoR2.totalScore, leoR2.points);

  const [zoeEnded, leoEnded] = await Promise.all([
    rejoinInbox.take('game:ended', { timeoutMs: 5000 }),
    leo.inbox.take('game:ended', { timeoutMs: 5000 }),
  ]);
  assert.equal(zoeEnded.yourScore, zoeR2.totalScore);
  assert.equal(leoEnded.yourScore, leoR2.totalScore);
  assert.equal(zoeEnded.yourRank, 1);
  assert.equal(leoEnded.yourRank, 2);
  assert.equal(zoeEnded.top5.length, 2);

  closeSockets(hostRoom.socket, rejoinSocket, leo.socket);
});

test('host disconnect does not stop auto-advance or result saving', { timeout: 20_000 }, async () => {
  const quiz = await createQuiz([
    {
      type: 'true_false',
      text: 'Hosts can drop.',
      options: ['True', 'False'],
      correctIndex: 0,
      durationSec: 1,
    },
  ]);

  const hostRoom = await createHostRoom(quiz.id);
  const code = hostRoom.code;
  const player = await joinPlayer(code, 'Ama');

  hostRoom.socket.emit('host:start', { code });
  const question = await player.inbox.take('game:question', {
    predicate: (payload) => payload.index === 0,
  });
  assert.equal(question.total, 1);
  hostRoom.socket.disconnect();

  player.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 0 });
  const result = await player.inbox.take('question:result', { timeoutMs: 3000 });
  assert.ok(result.points > 0);
  const ended = await player.inbox.take('game:ended', { timeoutMs: 5000 });
  assert.equal(ended.yourRank, 1);

  const saved = await waitForSession(code);
  assert.equal(saved.players.length, 1);
  assert.equal(saved.players[0].nickname, 'Ama');
  assert.ok(saved.players[0].answers[0].points > 0);

  closeSockets(player.socket);
});

test('socket errors: missing room, invalid nickname, ended game, bad rejoin token', { timeout: 30_000 }, async () => {
  const quiz = await createQuiz([
    {
      type: 'true_false',
      text: 'Short game.',
      options: ['True', 'False'],
      correctIndex: 0,
      durationSec: 1,
    },
  ]);

  const room = await createHostRoom(quiz.id);
  const socket = await connectSocket();
  const inbox = makeInbox(socket);

  socket.emit('player:join', { code: '000000', nickname: 'Nobody' });
  const missingRoomError = await inbox.take('error');
  assert.equal(missingRoomError.code, 'ROOM_NOT_FOUND');

  socket.emit('player:join', { code: room.code, nickname: '   ' });
  const nicknameError = await inbox.take('error');
  assert.equal(nicknameError.code, 'INVALID_NICKNAME');

  const joinedPromise = inbox.take('player:joined');
  socket.emit('player:join', { code: room.code, nickname: 'Valid' });
  const joined = await joinedPromise;
  assert.equal(joined.nickname, 'Valid');

  const rejoinSocket = await connectSocket();
  const rejoinInbox = makeInbox(rejoinSocket);
  rejoinSocket.emit('player:rejoin', { code: room.code, playerToken: 'not-a-real-token' });
  const tokenError = await rejoinInbox.take('error');
  assert.equal(tokenError.code, 'INVALID_PLAYER_TOKEN');

  room.socket.emit('host:start', { code: room.code });
  await room.inbox.take('game:ended', { timeoutMs: 5000 });

  const late = await connectSocket();
  const lateInbox = makeInbox(late);
  late.emit('player:join', { code: room.code, nickname: 'Too late' });
  const endedError = await lateInbox.take('error');
  assert.equal(endedError.code, 'GAME_ENDED');

  const createdPromise = room.inbox.take('room:created');
  room.socket.emit('host:create_room', { quizId: quiz.id });
  const created = await createdPromise;
  assert.match(created.code, /^\d{6}$/);

  closeSockets(socket, rejoinSocket, late, room.socket);
});

test('live player state and pause/resume stay in sync for host and players', { timeout: 30_000 }, async () => {
  const quiz = await createQuiz([
    {
      type: 'true_false',
      text: 'Pausing freezes the room.',
      options: ['True', 'False'],
      correctIndex: 0,
      durationSec: 2,
    },
  ]);

  const hostRoom = await createHostRoom(quiz.id);
  const { socket: hostSocket, inbox: hostInbox, code } = hostRoom;
  const ama = await joinPlayer(code, 'Ama');
  const kofi = await joinPlayer(code, 'Kofi');

  hostSocket.emit('host:start', { code });
  const [hostQuestion, amaQuestion, kofiQuestion] = await Promise.all([
    hostInbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
    ama.inbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
    kofi.inbox.take('game:question', { predicate: (payload) => payload.index === 0 }),
  ]);
  assert.equal(hostQuestion.startsAt, amaQuestion.startsAt);
  assert.equal(amaQuestion.startsAt, kofiQuestion.startsAt);

  const initialLive = await hostInbox.take('host:live_state', {
    predicate: (payload) => payload.index === 0 && payload.answered === 0,
  });
  assert.equal(initialLive.phase, 'question');
  assert.equal(initialLive.correctIndex, 0);
  assert.equal(initialLive.eligible, 2);
  assert.deepEqual(initialLive.choiceCounts, [0, 0]);
  assert.deepEqual(
    initialLive.players.map((player) => player.status),
    ['thinking', 'thinking'],
  );

  ama.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 0 });
  const answeredLive = await hostInbox.take('host:live_state', {
    predicate: (payload) => payload.index === 0 && payload.answered === 1,
  });
  assert.deepEqual(answeredLive.choiceCounts, [1, 0]);
  assert.deepEqual(
    answeredLive.players.map((player) => player.status),
    ['answered', 'thinking'],
  );
  assert.equal(answeredLive.players[0].choiceIndex, 0);

  hostSocket.emit('host:pause', { code });
  const [hostPaused, amaPaused, kofiPaused] = await Promise.all([
    hostInbox.take('game:paused'),
    ama.inbox.take('game:paused'),
    kofi.inbox.take('game:paused'),
  ]);
  assert.equal(hostPaused.index, 0);
  assert.equal(hostPaused.phase, 'question');
  assert.deepEqual(amaPaused, hostPaused);
  assert.deepEqual(kofiPaused, hostPaused);
  assert.ok(hostPaused.remainingMs > 0);
  assert.ok(hostPaused.remainingMs <= 2000);

  kofi.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 0 });
  await sleep(200);
  assert.ok(
    hostInbox.queued('host:live_state').every((payload) => payload.answered <= 1),
    'paused answers must not be counted',
  );

  await sleep(2200);
  assert.equal(ama.inbox.queued('question:result').length, 0);

  hostSocket.emit('host:resume', { code });
  const [hostResumed, amaResumed, kofiResumed] = await Promise.all([
    hostInbox.take('game:resumed'),
    ama.inbox.take('game:resumed'),
    kofi.inbox.take('game:resumed'),
  ]);
  assert.equal(hostResumed.index, 0);
  assert.equal(hostResumed.phase, 'question');
  assert.ok(hostResumed.remainingMs > 0);
  assert.ok(hostResumed.startsAt > hostQuestion.startsAt);
  assert.equal(hostResumed.durationMs, 2000);
  assert.deepEqual(amaResumed, hostResumed);
  assert.deepEqual(kofiResumed, hostResumed);

  kofi.socket.emit('player:answer', { code, questionIndex: 0, choiceIndex: 0 });
  const resumedLive = await hostInbox.take('host:live_state', {
    predicate: (payload) => payload.index === 0 && payload.answered === 2,
  });
  assert.deepEqual(resumedLive.choiceCounts, [2, 0]);
  assert.deepEqual(
    resumedLive.players.map((player) => player.status),
    ['answered', 'answered'],
  );

  const [amaResult, kofiResult] = await Promise.all([
    ama.inbox.take('question:result', { predicate: (result) => result.index === 0 }),
    kofi.inbox.take('question:result', { predicate: (result) => result.index === 0 }),
  ]);
  assert.ok(amaResult.points > 0);
  assert.ok(kofiResult.points > 0);

  const revealLive = await hostInbox.take('host:live_state', {
    predicate: (payload) => payload.index === 0 && payload.phase === 'reveal',
  });
  assert.equal(revealLive.answered, 2);
  assert.equal(revealLive.eligible, 2);

  const ended = await hostInbox.take('game:ended', { timeoutMs: 5000 });
  assert.equal(ended.leaderboard.length, 2);

  closeSockets(hostSocket, ama.socket, kofi.socket);
});

test('loopback guard: host REST and host socket events reject LAN callers', { timeout: 20_000 }, async (t) => {
  const info = await request('/api/server-info');
  assert.equal(info.status, 200);

  if (!info.data.lanUrl || info.data.lanUrl.includes('127.0.0.1')) {
    t.skip('No non-internal IPv4 address available to test LAN access.');
    return;
  }

  const lanUrl = info.data.lanUrl;
  for (const route of ['/api/quizzes', '/api/sessions', '/api/server-info']) {
    let response;
    try {
      response = await request(route, { base: lanUrl });
    } catch (error) {
      t.skip(`LAN address is not reachable from this machine: ${error.message}`);
      return;
    }
    assert.equal(response.status, 403, `${route} must reject LAN callers`);
    assert.equal(response.data.code, 'AUTH_REQUIRED');
  }

  const quiz = await createQuiz([
    {
      type: 'true_false',
      text: 'Loopback only.',
      options: ['True', 'False'],
      correctIndex: 0,
      durationSec: 10,
    },
  ]);

  const hostRoom = await createHostRoom(quiz.id);
  const lanSocket = await connectSocket(lanUrl);
  const lanInbox = makeInbox(lanSocket);

  lanSocket.emit('host:create_room', { quizId: quiz.id });
  const createError = await lanInbox.take('error');
  assert.equal(createError.code, 'AUTH_REQUIRED');

  lanSocket.emit('host:start', { code: hostRoom.code });
  const startError = await lanInbox.take('error');
  assert.equal(startError.code, 'AUTH_REQUIRED');

  const remotePlayer = await joinPlayer(hostRoom.code, 'Remote', lanUrl);
  assert.equal(remotePlayer.joined.nickname, 'Remote');

  closeSockets(lanSocket, remotePlayer.socket, hostRoom.socket);
});
