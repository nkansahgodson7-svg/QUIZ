import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioClient } from 'socket.io-client';
import { connectDb, disconnectDb } from '../src/db.js';
import { createQuizServer } from '../src/server.js';

let mongod;
let server;
let baseUrl;
let emailSequence = 0;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await connectDb(mongod.getUri());
  server = createQuizServer({ revealMs: 50 });
  await new Promise((resolve, reject) => {
    server.httpServer.once('error', reject);
    server.httpServer.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
});

after(async () => {
  if (server) await server.close();
  await disconnectDb();
  if (mongod) await mongod.stop();
});

function uniqueEmail(label) {
  emailSequence += 1;
  return `${label}-${Date.now()}-${emailSequence}@test.local`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
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

async function signupHost(label = 'host') {
  const email = uniqueEmail(label);
  const result = await request('/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'secret12' },
  });
  assert.equal(result.status, 201);
  return { email, token: result.data.token, host: result.data.host };
}

async function createQuiz(token, questions, title = 'Test quiz') {
  const result = await request('/api/quizzes', {
    method: 'POST',
    token,
    body: { title, questions },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.quiz;
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      auth: token ? { token } : {},
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

async function joinPlayer(code, nickname) {
  const socket = await connectSocket();
  const inbox = makeInbox(socket);
  const joinedPromise = inbox.take('player:joined', {
    timeoutMs: 5000,
    label: 'player:joined',
  });
  socket.emit('player:join', { code, nickname });
  const joined = await joinedPromise;
  return { socket, inbox, joined };
}

async function createHostRoom(token, quizId) {
  const socket = await connectSocket(token);
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

async function waitForSession(token, code) {
  let found = null;
  await waitUntil(
    async () => {
      const result = await request('/api/sessions', { token });
      assert.equal(result.status, 200);
      found = result.data.sessions.find((session) => session.code === code);
      return Boolean(found);
    },
    5000,
    'session to be saved',
  );
  const detail = await request(`/api/sessions/${found.id}`, { token });
  assert.equal(detail.status, 200);
  return detail.data.session;
}

function closeSockets(...sockets) {
  for (const socket of sockets) {
    if (socket) socket.disconnect();
  }
}

test('REST: signup, login, quiz save/load and ownership', async () => {
  const email = uniqueEmail('rest');
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'secret12' },
  });
  assert.equal(signup.status, 201);
  assert.ok(signup.data.token);
  assert.equal(signup.data.host.email, email);
  assert.equal(signup.data.host.passwordHash, undefined);

  const duplicate = await request('/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'secret12' },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.code, 'EMAIL_TAKEN');

  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'wrong-password' },
  });
  assert.equal(badLogin.status, 401);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'secret12' },
  });
  assert.equal(login.status, 200);
  const token = login.data.token;

  const me = await request('/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.data.host.email, email);

  const noAuth = await request('/api/quizzes');
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.data.code, 'AUTH_REQUIRED');

  const invalidQuiz = await request('/api/quizzes', {
    method: 'POST',
    token,
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
    token,
    body: { title: 'Geography', questions },
  });
  assert.equal(created.status, 201);
  const quiz = created.data.quiz;
  assert.equal(quiz.questions.length, 2);
  assert.equal(quiz.questions[0].durationSec, 15);
  assert.deepEqual(quiz.questions[1].options, ['True', 'False']);
  assert.equal(quiz.questions[1].durationSec, 20);

  const list = await request('/api/quizzes', { token });
  assert.equal(list.status, 200);
  assert.equal(list.data.quizzes.length, 1);

  const loaded = await request(`/api/quizzes/${quiz.id}`, { token });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.data.quiz.title, 'Geography');

  const updated = await request(`/api/quizzes/${quiz.id}`, {
    method: 'PUT',
    token,
    body: { title: 'Geography v2', questions },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.quiz.title, 'Geography v2');

  const otherHost = await signupHost('other');
  const forbidden = await request(`/api/quizzes/${quiz.id}`, { token: otherHost.token });
  assert.equal(forbidden.status, 404);

  const removed = await request(`/api/quizzes/${quiz.id}`, { method: 'DELETE', token });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.ok, true);

  const gone = await request(`/api/quizzes/${quiz.id}`, { token });
  assert.equal(gone.status, 404);
});

test('game flow: join, start, answer changes, scoring, auto-advance, saved session', { timeout: 30_000 }, async () => {
  const host = await signupHost('flow');
  const quiz = await createQuiz(host.token, [
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

  const hostRoom = await createHostRoom(host.token, quiz.id);
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

  const saved = await waitForSession(host.token, code);
  assert.equal(saved.code, code);
  assert.equal(saved.players.length, 2);

  const savedP1 = saved.players.find((player) => player.nickname === 'Kwame');
  const savedP2 = saved.players.find((player) => player.nickname === 'Kwame2');
  assert.equal(savedP1.answers.length, 2);
  assert.equal(savedP1.answers[0].choiceIndex, 3);
  assert.equal(savedP1.answers[0].correct, true);
  assert.equal(savedP1.answers[0].points, p1R1.points);
  assert.equal(savedP1.answers[1].choiceIndex, 0);
  assert.equal(savedP2.answers[1].choiceIndex, null);
  assert.equal(savedP2.answers[1].points, 0);
  assert.ok(saved.startedAt);
  assert.ok(saved.endedAt);

  closeSockets(hostSocket, playerOne.socket, playerTwo.socket);
});

test('rejoin keeps score; late joiner starts scoring on the next question', { timeout: 30_000 }, async () => {
  const host = await signupHost('rejoin');
  const quiz = await createQuiz(host.token, [
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

  const hostRoom = await createHostRoom(host.token, quiz.id);
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
  const host = await signupHost('hostdrop');
  const quiz = await createQuiz(host.token, [
    {
      type: 'true_false',
      text: 'Hosts can drop.',
      options: ['True', 'False'],
      correctIndex: 0,
      durationSec: 1,
    },
  ]);

  const hostRoom = await createHostRoom(host.token, quiz.id);
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

  const saved = await waitForSession(host.token, code);
  assert.equal(saved.players.length, 1);
  assert.equal(saved.players[0].nickname, 'Ama');
  assert.ok(saved.players[0].answers[0].points > 0);

  closeSockets(player.socket);
});

test('socket errors: auth, ownership, missing room', { timeout: 15_000 }, async () => {
  const hostA = await signupHost('auth-a');
  const hostB = await signupHost('auth-b');
  const quiz = await createQuiz(hostA.token, [
    {
      type: 'multiple_choice',
      text: 'Valid?',
      options: ['Yes', 'No'],
      correctIndex: 0,
      durationSec: 10,
    },
  ]);

  const noAuth = await connectSocket();
  const noAuthInbox = makeInbox(noAuth);
  noAuth.emit('host:create_room', { quizId: quiz.id });
  const authError = await noAuthInbox.take('error');
  assert.equal(authError.code, 'AUTH_REQUIRED');

  const hostBRoom = await connectSocket(hostB.token);
  const hostBInbox = makeInbox(hostBRoom);
  hostBRoom.emit('host:create_room', { quizId: quiz.id });
  const ownershipError = await hostBInbox.take('error');
  assert.equal(ownershipError.code, 'QUIZ_NOT_FOUND');

  const hostARoom = await createHostRoom(hostA.token, quiz.id);
  hostBRoom.emit('host:start', { code: hostARoom.code });
  const notHostError = await hostBInbox.take('error');
  assert.equal(notHostError.code, 'NOT_HOST');

  const stranger = await connectSocket();
  const strangerInbox = makeInbox(stranger);
  stranger.emit('player:join', { code: '000000', nickname: 'Nobody' });
  const missingRoomError = await strangerInbox.take('error');
  assert.equal(missingRoomError.code, 'ROOM_NOT_FOUND');

  closeSockets(noAuth, hostBRoom, hostARoom.socket, stranger);
});
