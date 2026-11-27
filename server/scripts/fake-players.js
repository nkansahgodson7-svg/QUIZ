#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';

const { values: options } = parseArgs({
  options: {
    server: { type: 'string', default: process.env.QUIZ_SERVER || 'http://localhost:4000' },
    players: { type: 'string', default: '20' },
    questions: { type: 'string', default: '2' },
    duration: { type: 'string', default: '5' },
    'answer-delay': { type: 'string', default: '1000' },
    timeout: { type: 'string', default: '' },
    'quiz-id': { type: 'string', default: process.env.QUIZ_ID || '' },
    code: { type: 'string', default: '' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (options.help) {
  console.log(`Usage: node scripts/fake-players.js [options]

Creates a quiz, room, fake players, starts the game and answers.
This exercises the full socket contract with no UI.

The host socket must connect from the server machine (loopback), so keep the
default --server URL unless you run this script on the host itself.

Options:
  --server URL         Server base URL (default http://localhost:4000)
  --players N          Number of fake players (default 20, try 300)
  --questions N        Questions to create when making a quiz (default 2)
  --duration SEC       Per-question time limit for the generated quiz (default 5)
  --answer-delay MS    Max random answer delay (default 1000)
  --timeout SEC        Overall wait timeout (default computed)
  --quiz-id ID         Reuse a saved quiz instead of creating one
  --code CODE          Join an existing room; the host starts it separately
  -h, --help           Show this help

Environment: QUIZ_SERVER, QUIZ_ID.

Examples:
  node scripts/fake-players.js --players 5 --questions 2 --duration 3
  node scripts/fake-players.js --players 300 --questions 2 --duration 10
  node scripts/fake-players.js --code 123456 --players 300
`);
  process.exit(0);
}

function readInt(name, value, fallback, min, max) {
  if (value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

const serverUrl = options.server.replace(/\/+$/, '');
const playerCount = readInt('players', options.players, 20, 1, 1000);
const questionCount = readInt('questions', options.questions, 2, 1, 100);
const durationSec = readInt('duration', options.duration, 5, 1, 300);
const answerDelayMax = readInt('answer-delay', options['answer-delay'], 1000, 0, 300000);
const roomCode = options.code.trim();

function log(message) {
  console.log(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms waiting for ${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  const response = await fetch(`${serverUrl}${path}`, {
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
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${data?.message || data?.raw || text}`,
    );
  }
  return data;
}

function connectSocket() {
  return new Promise((resolve, reject) => {
    const socket = io(serverUrl, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 20_000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Timed out connecting to ${serverUrl}`));
    }, 20_000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Socket connection failed: ${error.message}`));
    });
  });
}

function waitForEvent(socket, event, { predicate = () => true, timeoutMs = 10_000, label } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${label || event}`));
    }, timeoutMs);

    function handler(payload) {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off(event, handler);
    }

    socket.on(event, handler);
  });
}

async function ensureQuizId() {
  if (options['quiz-id']) return options['quiz-id'];

  const questions = Array.from({ length: questionCount }, (_value, index) => {
    if (index % 2 === 1) {
      return {
        type: 'true_false',
        text: `Load test true/false question ${index + 1}`,
        options: ['True', 'False'],
        correctIndex: 0,
        durationSec,
      };
    }
    return {
      type: 'multiple_choice',
      text: `Load test multiple-choice question ${index + 1}`,
      options: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
      correctIndex: 1,
      durationSec,
    };
  });

  const data = await api('/api/quizzes', {
    method: 'POST',
    body: { title: `Fake players ${new Date().toISOString()}`, questions },
  });
  return data.quiz.id;
}

async function createRoom(host, quizId) {
  const created = waitForEvent(host, 'room:created', {
    timeoutMs: 15_000,
    label: 'room:created (check quiz id and loopback host access)',
  });
  host.emit('host:create_room', { quizId });
  return created;
}

async function createFakePlayer({ index, code, answerDelayMax }) {
  const socket = await connectSocket();
  const state = {
    index,
    socket,
    nickname: `Fake${index + 1}`,
    player: null,
    results: new Map(),
    ended: null,
    questionsSeen: 0,
    firstSeenIndex: null,
    answersSent: 0,
    errors: [],
  };

  socket.on('error', (payload) => {
    state.errors.push(payload);
  });

  socket.on('game:question', (question) => {
    state.questionsSeen += 1;
    if (state.firstSeenIndex === null) state.firstSeenIndex = question.index;
    const latestDelay = Math.min(
      answerDelayMax,
      Math.max(1, Math.floor(question.durationMs * 0.75)),
    );
    const delay = Math.floor(Math.random() * Math.max(1, latestDelay));
    setTimeout(() => {
      if (!socket.connected) return;
      state.answersSent += 1;
      socket.emit('player:answer', {
        code,
        questionIndex: question.index,
        choiceIndex: Math.floor(Math.random() * question.options.length),
      });
    }, delay);
  });

  socket.on('question:result', (result) => {
    state.results.set(result.index, result);
    if (state.firstSeenIndex === null) state.firstSeenIndex = result.index;
  });

  state.endedPromise = new Promise((resolve) => {
    socket.on('game:ended', (payload) => {
      state.ended = payload;
      resolve(payload);
    });
  });

  const joined = waitForEvent(socket, 'player:joined', {
    timeoutMs: 15_000,
    label: `player:joined for Fake${index + 1}`,
  });
  socket.emit('player:join', { code, nickname: state.nickname });
  state.player = await joined;
  state.nickname = state.player.nickname;

  return state;
}

async function closeSockets(host, players) {
  if (host) host.disconnect();
  for (const player of players) player.socket.disconnect();
  await sleep(100);
}

async function run() {
  const startedAt = Date.now();
  let host = null;
  const players = [];

  log(`Server: ${serverUrl}`);

  let code = roomCode;
  let quizId = options['quiz-id'] || '';

  try {
    if (!code) {
      quizId = await ensureQuizId();
      host = await connectSocket();
      host.on('error', (payload) => {
        console.error(`Host socket error: ${payload?.code} ${payload?.message || ''}`);
      });

      const created = await createRoom(host, quizId);
      code = created.code;
      log(`Quiz: ${quizId}`);
    }
    if (!code) throw new Error('No room code available.');

    log(`Room: ${code}`);
    log(`Connecting ${playerCount} fake player${playerCount === 1 ? '' : 's'}...`);

    const batchSize = 50;
    for (let start = 0; start < playerCount; start += batchSize) {
      const batch = [];
      for (let i = start; i < Math.min(start + batchSize, playerCount); i += 1) {
        batch.push(createFakePlayer({ index: i, code, answerDelayMax }));
      }
      const created = await Promise.all(batch);
      players.push(...created);
      log(`  joined ${players.length}/${playerCount}`);
    }

    const duplicateNicknames = players.length - new Set(players.map((p) => p.nickname)).size;
    const joinErrors = players.reduce((total, p) => total + p.errors.length, 0);
    if (duplicateNicknames > 0) throw new Error('Duplicate nicknames were assigned.');
    if (joinErrors > 0) {
      throw new Error(`Players received ${joinErrors} server error event(s) while joining.`);
    }

    log(`All ${players.length} players joined.`);

    let hostEndedPromise = null;
    const hostAnswerCounts = new Map();
    if (host) {
      host.on('game:answer_count', (payload) => {
        hostAnswerCounts.set(payload.index, payload);
      });
      hostEndedPromise = waitForEvent(host, 'game:ended', {
        timeoutMs: 5 * 60_000,
        label: 'host game:ended',
      });
      const revealed = waitForEvent(host, 'game:question', {
        timeoutMs: 15_000,
        label: 'first game:question after host:start',
      });
      host.emit('host:start', { code });
      const firstQuestion = await revealed;
      log(
        `Game started: question 1/${firstQuestion.total}, `
        + `${firstQuestion.durationMs}ms per question, ${firstQuestion.options.length} options.`,
      );
    } else {
      log('Waiting for the host to start the room...');
    }

    const computedTimeoutSec = host && !options['quiz-id']
      ? Math.max(60, questionCount * (durationSec + 7) + 30)
      : 300;
    const timeoutSec = options.timeout
      ? readInt('timeout', options.timeout, computedTimeoutSec, 5, 3600)
      : computedTimeoutSec;
    log(`Waiting up to ${timeoutSec}s for the game to finish...`);

    const allPlayersEnded = Promise.all(players.map((player) => player.endedPromise));
    await withTimeout(allPlayersEnded, timeoutSec * 1000, 'all players to receive game:ended');

    let hostEnded = null;
    if (hostEndedPromise) {
      hostEnded = await withTimeout(hostEndedPromise, 15_000, 'host game:ended');
    }

    const totalQuestions = Math.max(
      0,
      ...players.map((player) => player.questionsSeen),
      ...players.flatMap((player) => Array.from(player.results.keys()).map((index) => index + 1)),
    );

    log('');
    log('Results');
    for (let index = 0; index < totalQuestions; index += 1) {
      const resultCount = players.filter((player) => player.results.has(index)).length;
      const count = hostAnswerCounts.get(index);
      const countLabel = count ? ` | host count ${count.answered}/${count.total}` : '';
      log(`  Q${index + 1}: ${resultCount}/${players.length} player results${countLabel}`);
    }

    const missingResults = players.filter((player) => {
      const firstIndex = player.firstSeenIndex ?? totalQuestions;
      const expected = Math.max(0, totalQuestions - firstIndex);
      return player.results.size < expected;
    });
    const missingEnd = players.filter((player) => !player.ended);
    const totalErrors = players.reduce((total, player) => total + player.errors.length, 0);
    if (totalErrors > 0) {
      const codes = new Map();
      for (const player of players) {
        for (const error of player.errors) {
          codes.set(error.code, (codes.get(error.code) || 0) + 1);
        }
      }
      log(`  Player errors: ${Array.from(codes, ([codeName, count]) => `${codeName}x${count}`).join(', ')}`);
    }

    if (hostEnded) {
      log(`  Host leaderboard entries: ${hostEnded.leaderboard?.length ?? 0}`);
      const top = (hostEnded.leaderboard || []).slice(0, 3);
      if (top.length > 0) {
        log(
          `  Top: ${top
            .map((entry) => `#${entry.rank} ${entry.nickname} (${entry.totalScore})`)
            .join(', ')}`,
        );
      }
    }

    log('');
    if (missingResults.length > 0) throw new Error(
      `${missingResults.length} player(s) missed question:result events.`,
    );
    if (missingEnd.length > 0) throw new Error(
      `${missingEnd.length} player(s) missed game:ended.`,
    );
    if (totalErrors > 0) throw new Error(`${totalErrors} player error event(s) were received.`);

    log(
      `PASS: ${players.length} players, ${totalQuestions} questions, `
      + `${((Date.now() - startedAt) / 1000).toFixed(1)}s total.`,
    );
  } finally {
    await closeSockets(host, players);
  }
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
