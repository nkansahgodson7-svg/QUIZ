/**
 * Mock game server for the client. Implements the Socket.IO contract plus the
 * REST routes the host console needs.
 *
 *   node mock/server.mjs        (or npm run mock)
 *
 * Accounts, quizzes, and sessions live in memory and reset when the mock stops.
 * Sign up from /host with any email and a 6+ character password. New accounts
 * get a demo quiz, and finished games are saved for Past Results.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'

const PORT = Number(process.env.MOCK_PORT || 4000)
const REVEAL_MS = 5000
const MAX_PLAYERS = 300
const BOT_TARGET = 14

const DEMO_QUIZ = {
  title: 'The Big Brain Warm-Up',
  questions: [
    {
      type: 'multiple_choice',
      text: 'Which planet is known as the Red Planet?',
      options: ['Venus', 'Mars', 'Jupiter', 'Mercury'],
      correctIndex: 1,
      durationSec: 15,
    },
    {
      type: 'true_false',
      text: 'Octopuses have three hearts.',
      options: ['True', 'False'],
      correctIndex: 0,
      durationSec: 12,
    },
    {
      type: 'multiple_choice',
      text: 'What is the largest ocean on Earth?',
      options: ['Atlantic', 'Indian', 'Pacific', 'Arctic'],
      correctIndex: 2,
      durationSec: 18,
    },
    {
      type: 'multiple_choice',
      text: 'Which language has the most native speakers?',
      options: ['English', 'Spanish', 'Hindi', 'Mandarin Chinese'],
      correctIndex: 3,
      durationSec: 15,
    },
    {
      type: 'true_false',
      text: 'A group of flamingos is called a flamboyance.',
      options: ['True', 'False'],
      correctIndex: 0,
      durationSec: 10,
    },
  ],
}

const BOT_NAMES = [
  'Ama',
  'Kwame',
  'Zuri',
  'Noah',
  'Priya',
  'Leo',
  'Maya',
  'Kofi',
  'Sofia',
  'Ethan',
  'Nia',
  'Ravi',
  'Ines',
  'Tobi',
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** @type {Map<string, any>} */
const rooms = new Map()
/** @type {Map<string, any>} */
const hosts = new Map()
/** @type {Map<string, string>} */
const hostTokens = new Map()
/** @type {Map<string, any>} */
const quizzes = new Map()
/** @type {Map<string, any>} */
const sessions = new Map()
let hostSequence = 0
let quizSequence = 0
let sessionSequence = 0

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

const httpServer = createServer((req, res) => {
  handleHttp(req, res).catch((error) => {
    if (res.headersSent) {
      res.end()
      return
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, { code: error.code, message: error.message })
      return
    }
    console.error('[mock] http error', error)
    sendJson(res, 500, { code: 'INTERNAL_ERROR', message: 'Unexpected mock server error.' })
  })
})

const io = new Server(httpServer, {
  cors: { origin: '*' },
})

function log(...args) {
  console.log('[mock]', ...args)
}

function fail(socket, code, message) {
  socket.emit('error', { code, message })
  log('error ->', code, message)
}

function readHostToken(socket) {
  const raw = socket.handshake.auth?.token ?? socket.handshake.query?.token
  if (typeof raw !== 'string') return null
  const token = raw.replace(/^Bearer\s+/i, '').trim()
  return token || null
}

function requireHost(socket) {
  const token = readHostToken(socket)
  const hostId = token ? hostTokens.get(token) : null
  if (!hostId) {
    fail(socket, 'AUTH_REQUIRED', 'Host authentication is required.')
    return null
  }
  return hostId
}

function newCode() {
  let code
  do {
    code = String(Math.floor(100000 + Math.random() * 900000))
  } while (rooms.has(code))
  return code
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function sendNoContent(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  })
  res.end()
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.'))
      }
    })
    req.on('error', reject)
  })
}

function publicHost(host) {
  return { id: host.id, email: host.email, createdAt: host.createdAt }
}

function findHostById(id) {
  for (const host of hosts.values()) {
    if (host.id === id) return host
  }
  return null
}

function authHost(req) {
  const header = req.headers.authorization ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  const hostId = token ? hostTokens.get(token) : null
  return hostId ? findHostById(hostId) : null
}

function requireHttpHost(req) {
  const host = authHost(req)
  if (!host) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Host authentication is required.')
  }
  return host
}

function issueToken(hostId) {
  const token = `mock_${randomUUID()}`
  hostTokens.set(token, hostId)
  return token
}

function normalizeQuizInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) throw new HttpError(400, 'VALIDATION_ERROR', 'title cannot be empty.')
  if (title.length > 120) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'title must be at most 120 characters.')
  }
  if (!Array.isArray(body?.questions) || body.questions.length < 1) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A quiz needs at least one question.')
  }
  if (body.questions.length > 100) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A quiz can have at most 100 questions.')
  }

  const questions = body.questions.map((question, index) => {
    const label = `Question ${index + 1}`
    const type = question?.type
    if (type !== 'multiple_choice' && type !== 'true_false') {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `${label} type must be "multiple_choice" or "true_false".`,
      )
    }

    const text = typeof question.text === 'string' ? question.text.trim() : ''
    if (!text) throw new HttpError(400, 'VALIDATION_ERROR', `${label} text cannot be empty.`)
    if (text.length > 1000) {
      throw new HttpError(400, 'VALIDATION_ERROR', `${label} text is too long.`)
    }

    const durationSec =
      question.durationSec === undefined || question.durationSec === null
        ? 20
        : Number(question.durationSec)
    if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 300) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `${label} durationSec must be an integer from 1 to 300.`,
      )
    }

    if (type === 'true_false') {
      const correctIndex = Number(question.correctIndex)
      if (correctIndex !== 0 && correctIndex !== 1) {
        throw new HttpError(400, 'VALIDATION_ERROR', `${label} correctIndex must be 0 or 1.`)
      }
      return {
        type,
        text,
        options: ['True', 'False'],
        correctIndex,
        durationSec,
      }
    }

    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 4) {
      throw new HttpError(400, 'VALIDATION_ERROR', `${label} must have 2 to 4 options.`)
    }
    const options = question.options.map((option, optionIndex) => {
      const value = typeof option === 'string' ? option.trim() : ''
      if (!value) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `${label} option ${optionIndex + 1} cannot be empty.`,
        )
      }
      if (value.length > 200) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `${label} option ${optionIndex + 1} is too long.`,
        )
      }
      return value
    })
    const correctIndex = Number(question.correctIndex)
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `${label} correctIndex must point at one of the options.`,
      )
    }
    return { type, text, options, correctIndex, durationSec }
  })

  return { title, questions }
}

function seedDemoQuiz(hostId) {
  const now = new Date().toISOString()
  const quiz = {
    id: `quiz_${++quizSequence}`,
    hostId,
    title: DEMO_QUIZ.title,
    questions: DEMO_QUIZ.questions.map((question) => ({
      ...question,
      options: [...question.options],
    })),
    createdAt: now,
    updatedAt: now,
  }
  quizzes.set(quiz.id, quiz)
  return quiz
}

async function handleHttp(req, res) {
  if (req.method === 'OPTIONS') {
    sendNoContent(res)
    return
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname

  if (req.method === 'GET' && path === '/health') {
    sendJson(res, 200, {
      ok: true,
      rooms: rooms.size,
      hosts: hosts.size,
      quizzes: quizzes.size,
      sessions: sessions.size,
    })
    return
  }

  if (req.method === 'POST' && path === '/api/auth/signup') {
    const body = await readJson(req)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new HttpError(400, 'INVALID_CREDENTIALS', 'Enter a valid email address.')
    }
    if (password.length < 6 || password.length > 200) {
      throw new HttpError(400, 'INVALID_CREDENTIALS', 'Password must be 6 to 200 characters.')
    }
    if (hosts.has(email)) {
      throw new HttpError(
        409,
        'EMAIL_TAKEN',
        'An account with that email already exists.',
      )
    }

    const host = {
      id: `host_${++hostSequence}`,
      email,
      password,
      createdAt: new Date().toISOString(),
    }
    hosts.set(email, host)
    seedDemoQuiz(host.id)
    sendJson(res, 201, { token: issueToken(host.id), host: publicHost(host) })
    return
  }

  if (req.method === 'POST' && path === '/api/auth/login') {
    const body = await readJson(req)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const host = hosts.get(email)
    if (!host || host.password !== password) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }
    sendJson(res, 200, { token: issueToken(host.id), host: publicHost(host) })
    return
  }

  if (req.method === 'GET' && path === '/api/auth/me') {
    const host = requireHttpHost(req)
    sendJson(res, 200, { host: publicHost(host) })
    return
  }

  if (path === '/api/quizzes') {
    const host = requireHttpHost(req)

    if (req.method === 'GET') {
      const list = [...quizzes.values()]
        .filter((quiz) => quiz.hostId === host.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      sendJson(res, 200, { quizzes: list })
      return
    }

    if (req.method === 'POST') {
      const input = normalizeQuizInput(await readJson(req))
      const now = new Date().toISOString()
      const quiz = {
        id: `quiz_${++quizSequence}`,
        hostId: host.id,
        title: input.title,
        questions: input.questions,
        createdAt: now,
        updatedAt: now,
      }
      quizzes.set(quiz.id, quiz)
      sendJson(res, 201, { quiz })
      return
    }
  }

  const quizMatch = path.match(/^\/api\/quizzes\/([^/]+)$/)
  if (quizMatch) {
    const host = requireHttpHost(req)
    const quizId = decodeURIComponent(quizMatch[1])
    const quiz = quizzes.get(quizId)
    if (!quiz || quiz.hostId !== host.id) {
      throw new HttpError(404, 'QUIZ_NOT_FOUND', 'Quiz not found.')
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { quiz })
      return
    }
    if (req.method === 'PUT') {
      const input = normalizeQuizInput(await readJson(req))
      quiz.title = input.title
      quiz.questions = input.questions
      quiz.updatedAt = new Date().toISOString()
      sendJson(res, 200, { quiz })
      return
    }
    if (req.method === 'DELETE') {
      quizzes.delete(quiz.id)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  if (req.method === 'GET' && path === '/api/sessions') {
    const host = requireHttpHost(req)
    const list = [...sessions.values()]
      .filter((session) => session.hostId === host.id)
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
      .map((session) => ({
        id: session.id,
        quizId: session.quizId,
        quizTitle: session.quizTitle,
        code: session.code,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        playerCount: session.players.length,
      }))
    sendJson(res, 200, { sessions: list })
    return
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/)
  if (req.method === 'GET' && sessionMatch) {
    const host = requireHttpHost(req)
    const session = sessions.get(decodeURIComponent(sessionMatch[1]))
    if (!session || session.hostId !== host.id) {
      throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.')
    }
    sendJson(res, 200, { session })
    return
  }

  sendJson(res, 404, { code: 'NOT_FOUND', message: 'Not found.' })
}

function makePlayer(nickname, { bot = false, socketId = null, eligibleFromIndex = 0 } = {}) {
  return {
    id: randomUUID(),
    token: randomUUID(),
    nickname,
    score: 0,
    bot,
    socketId,
    eligibleFromIndex,
    lastPoints: 0,
    lastAnswer: null,
    lastResult: null,
    answers: new Map(),
  }
}

function uniqueNickname(room, raw) {
  const base = raw.trim().replace(/\s+/g, ' ').slice(0, 24)
  const taken = new Set([...room.players.values()].map((p) => p.nickname.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  let n = 2
  while (taken.has(`${base}${n}`.toLowerCase())) n += 1
  return `${base}${n}`
}

function showLobby(room) {
  if (room.phase !== 'lobby') return
  const payload = { playerCount: room.players.size }
  for (const id of hostSockets(room)) io.to(id).emit('lobby:update', payload)
}

function hostSockets(room) {
  return [...room.hostSockets].filter((id) => io.sockets.sockets.has(id))
}

function emitToHosts(room, event, payload) {
  for (const id of hostSockets(room)) io.to(id).emit(event, payload)
}

function ranked(room) {
  const ordered = [...room.players.values()].sort(
    (a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname),
  )
  let previous = null
  let previousRank = 0
  return ordered.map((player, i) => {
    const rank = previous !== null && player.score === previous ? previousRank : i + 1
    previous = player.score
    previousRank = rank
    return { player, rank }
  })
}

function topRows(rows, n = 5) {
  return rows.slice(0, n).map(({ player, rank }) => ({
    playerId: player.id,
    nickname: player.nickname,
    totalScore: player.score,
    rank,
  }))
}

function fullRows(room) {
  return ranked(room).map(({ player, rank }) => ({
    playerId: player.id,
    nickname: player.nickname,
    totalScore: player.score,
    rank,
  }))
}

function rankOf(rows, player) {
  return rows.find((row) => row.player.id === player.id)?.rank ?? rows.length
}

function eligible(room, player) {
  return player.eligibleFromIndex <= room.qIndex
}

function eligibleCount(room) {
  return [...room.players.values()].filter((player) => eligible(room, player)).length
}

function questionPayload(room, player = null) {
  return {
    ...room.question,
    myChoiceIndex: player ? (room.answers.get(player.id)?.choiceIndex ?? null) : null,
  }
}

function emitQuestionToEveryone(room) {
  for (const id of hostSockets(room)) {
    io.to(id).emit('game:question', questionPayload(room))
  }
  for (const player of room.players.values()) {
    if (player.bot || !player.socketId) continue
    io.to(player.socketId).emit('game:question', questionPayload(room, player))
  }
}

function emitAnswerCount(room) {
  if (room.phase !== 'question' || !room.question) return
  emitToHosts(room, 'game:answer_count', {
    index: room.question.index,
    answered: room.answers.size,
    total: eligibleCount(room),
  })
}

function clearTimers(room) {
  for (const timer of room.timeouts) clearTimeout(timer)
  room.timeouts = []
  if (room.botJoinTimer) {
    clearInterval(room.botJoinTimer)
    room.botJoinTimer = null
  }
}

function recordAnswer(room, player, choiceIndex, at) {
  if (room.phase !== 'question' || !room.question) return false
  if (at >= room.qEndsAt) return false
  if (!eligible(room, player)) return false
  room.answers.set(player.id, { choiceIndex, at })
  emitAnswerCount(room)
  return true
}

function sendQuestion(room) {
  const questions = room.quiz.questions
  const q = questions[room.qIndex]
  if (!q) return endGame(room)

  room.phase = 'question'
  room.answers = new Map()
  room.correctIndex = null
  room.lastTop5 = []
  room.lastRows = null
  room.qDurationMs = (q.durationSec ?? 20) * 1000
  room.qStartsAt = Date.now()
  room.qEndsAt = room.qStartsAt + room.qDurationMs

  room.question = {
    index: room.qIndex,
    total: questions.length,
    type: q.type,
    text: q.text,
    options: q.options,
    startsAt: room.qStartsAt,
    durationMs: room.qDurationMs,
  }

  emitQuestionToEveryone(room)
  emitAnswerCount(room)
  log(`room ${room.code} question ${room.qIndex + 1}/${questions.length}`)

  for (const player of room.players.values()) {
    if (!player.bot || !eligible(room, player)) continue
    const when = room.qStartsAt + (0.18 + Math.random() * 0.62) * room.qDurationMs
    const timer = setTimeout(() => {
      if (room.phase !== 'question' || room.question?.index !== room.qIndex) return
      const correct = Math.random() < 0.76
      const wrongChoices = q.options.map((_, i) => i).filter((i) => i !== q.correctIndex)
      const choiceIndex = correct
        ? q.correctIndex
        : wrongChoices[Math.floor(Math.random() * wrongChoices.length)]
      recordAnswer(room, player, choiceIndex, Date.now())
    }, Math.max(50, when - Date.now()))
    room.timeouts.push(timer)
  }

  room.timeouts.push(
    setTimeout(() => endQuestion(room), Math.max(0, room.qEndsAt - Date.now())),
  )
}

function endQuestion(room) {
  if (room.phase !== 'question' || !room.question) return
  room.phase = 'reveal'
  const q = room.quiz.questions[room.qIndex]

  for (const player of room.players.values()) {
    const answer = room.answers.get(player.id)
    const correct = Boolean(
      eligible(room, player) && answer && answer.choiceIndex === q.correctIndex,
    )
    let points = 0
    if (correct && answer) {
      const timeLeft = room.qEndsAt - answer.at
      points = Math.round((1000 * timeLeft) / room.qDurationMs)
    }
    player.score += points
    player.lastPoints = points
    player.lastAnswer = answer?.choiceIndex ?? null
    player.answers.set(room.qIndex, {
      questionIndex: room.qIndex,
      choiceIndex: answer?.choiceIndex ?? null,
      correct,
      points,
      answeredAt: answer ? new Date(answer.at).toISOString() : null,
      responseMs: answer ? Math.max(0, answer.at - room.qStartsAt) : null,
    })
  }

  const rows = ranked(room)
  room.correctIndex = q.correctIndex
  room.lastTop5 = topRows(rows)
  room.lastRows = rows

  for (const player of room.players.values()) {
    player.lastResult = {
      index: room.question.index,
      correctIndex: q.correctIndex,
      points: player.lastPoints,
      totalScore: player.score,
      rank: rankOf(rows, player),
      top5: room.lastTop5,
    }
    if (player.bot || !player.socketId) continue
    io.to(player.socketId).emit('question:result', player.lastResult)
  }

  log(`room ${room.code} reveal ${room.qIndex + 1}`, room.lastTop5.slice(0, 3))
  room.timeouts.push(setTimeout(() => advance(room), REVEAL_MS))
}

function advance(room) {
  if (room.phase !== 'reveal') return
  room.qIndex += 1
  if (room.qIndex >= room.quiz.questions.length) {
    endGame(room)
  } else {
    sendQuestion(room)
  }
}

function endGame(room) {
  clearTimers(room)
  room.phase = 'ended'
  const rows = ranked(room)
  const top5 = topRows(rows)

  for (const player of room.players.values()) {
    if (player.bot || !player.socketId) continue
    io.to(player.socketId).emit('game:ended', {
      yourRank: rankOf(rows, player),
      yourScore: player.score,
      top5,
    })
  }

  emitToHosts(room, 'game:ended', { leaderboard: fullRows(room) })

  const endedAt = new Date().toISOString()
  const session = {
    id: `session_${++sessionSequence}`,
    hostId: room.hostId,
    quizId: room.quizId,
    quizTitle: room.quiz.title,
    code: room.code,
    startedAt: new Date(room.startedAt ?? Date.now()).toISOString(),
    endedAt,
    players: [...room.players.values()].map((player) => ({
      playerId: player.id,
      nickname: player.nickname,
      totalScore: player.score,
      answers: room.quiz.questions.map(
        (_question, index) =>
          player.answers.get(index) ?? {
            questionIndex: index,
            choiceIndex: null,
            correct: false,
            points: 0,
            answeredAt: null,
            responseMs: null,
          },
      ),
    })),
  }
  sessions.set(session.id, session)

  log(`room ${room.code} ended`, `${room.players.size} players`, `session ${session.id}`)

  setTimeout(() => {
    if (rooms.get(room.code) === room) rooms.delete(room.code)
  }, 10 * 60 * 1000)
}

function sendStateTo(socket, room, player) {
  if (room.phase === 'question') {
    socket.emit('game:question', questionPayload(room, player))
  }
  if (
    room.phase === 'reveal' &&
    player.lastResult &&
    player.lastResult.index === room.qIndex
  ) {
    socket.emit('question:result', player.lastResult)
  }
  if (room.phase === 'ended') {
    const rows = ranked(room)
    socket.emit('game:ended', {
      yourRank: rankOf(rows, player),
      yourScore: player.score,
      top5: topRows(rows),
    })
  }
}

function addBot(room, name) {
  const player = makePlayer(uniqueNickname(room, name), { bot: true })
  room.players.set(player.id, player)
  return player
}

io.on('connection', (socket) => {
  log('connect', socket.id)

  socket.on('host:create_room', (payload) => {
    const hostId = requireHost(socket)
    if (!hostId) return

    const quizId = String(payload?.quizId ?? '').trim()
    const quiz = quizzes.get(quizId)
    if (!quiz || quiz.hostId !== hostId) {
      return fail(socket, 'QUIZ_NOT_FOUND', 'Quiz not found for this host.')
    }
    if (quiz.questions.length === 0) {
      return fail(socket, 'QUIZ_EMPTY', 'That quiz has no questions.')
    }

    const code = newCode()
    const room = {
      code,
      quizId,
      quiz,
      hostId,
      hostSockets: new Set([socket.id]),
      players: new Map(),
      phase: 'lobby',
      qIndex: -1,
      qDurationMs: 0,
      qStartsAt: 0,
      qEndsAt: 0,
      question: null,
      answers: new Map(),
      correctIndex: null,
      lastTop5: [],
      lastRows: null,
      timeouts: [],
      botJoinTimer: null,
    }
    rooms.set(code, room)
    socket.join(code)
    socket.data.roomCode = code

    const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5)
    for (const name of shuffled.slice(0, 7)) addBot(room, name)
    room.botNames = shuffled.slice(7)

    socket.emit('room:created', { code })
    showLobby(room)
    log('room created', code, 'quiz', quizId)

    room.botJoinTimer = setInterval(() => {
      if (room.phase !== 'lobby') return
      if (room.players.size >= BOT_TARGET) return
      addBot(room, room.botNames.pop() || `Player${room.players.size + 1}`)
      showLobby(room)
    }, 2800)
  })

  socket.on('host:start', (payload) => {
    const hostId = requireHost(socket)
    if (!hostId) return

    const code = String(payload?.code ?? '').trim()
    const room = rooms.get(code)
    if (!room) return fail(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.')
    if (room.hostId !== hostId) {
      return fail(socket, 'NOT_HOST', 'Authenticated host does not own that room.')
    }
    if (room.phase === 'ended') {
      return fail(socket, 'GAME_ENDED', 'That game has already ended.')
    }
    if (room.phase !== 'lobby') {
      return fail(socket, 'ALREADY_STARTED', 'This game has already started.')
    }

    room.startedAt = Date.now()
    room.qIndex = 0
    sendQuestion(room)
  })

  socket.on('player:join', (payload) => {
    const code = String(payload?.code ?? '').trim()
    const room = rooms.get(code)
    if (!room) return fail(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.')
    if (room.phase === 'ended') {
      return fail(socket, 'GAME_ENDED', 'That game has already ended.')
    }
    if (socket.data.playerId) {
      return fail(socket, 'ALREADY_JOINED', 'This socket has already joined a room.')
    }
    if (room.players.size >= MAX_PLAYERS) {
      return fail(socket, 'ROOM_FULL', 'That room is full.')
    }

    const rawNickname = typeof payload?.nickname === 'string' ? payload.nickname.trim() : ''
    if (!rawNickname || rawNickname.length > 24) {
      return fail(socket, 'INVALID_NICKNAME', 'Nickname must be 1 to 24 characters.')
    }

    const player = makePlayer(uniqueNickname(room, rawNickname), {
      socketId: socket.id,
      eligibleFromIndex: room.phase === 'lobby' ? 0 : room.qIndex + 1,
    })
    room.players.set(player.id, player)
    socket.data.roomCode = code
    socket.data.playerId = player.id
    socket.join(code)

    socket.emit('player:joined', {
      playerId: player.id,
      nickname: player.nickname,
      playerToken: player.token,
    })
    showLobby(room)
    sendStateTo(socket, room, player)
    log(`room ${code} join`, player.nickname, room.phase)
  })

  socket.on('player:rejoin', (payload) => {
    const code = String(payload?.code ?? '').trim()
    const token = String(payload?.playerToken ?? '')
    const room = rooms.get(code)
    if (!room) return fail(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.')

    const player = [...room.players.values()].find((p) => p.token === token && token)
    if (!player) {
      return fail(socket, 'INVALID_PLAYER_TOKEN', 'Rejoin token is unknown or expired.')
    }

    player.socketId = socket.id
    socket.data.roomCode = code
    socket.data.playerId = player.id
    socket.join(code)
    socket.emit('player:joined', {
      playerId: player.id,
      nickname: player.nickname,
      playerToken: player.token,
    })
    showLobby(room)
    sendStateTo(socket, room, player)
    log(`room ${code} rejoin`, player.nickname, room.phase)
  })

  socket.on('player:answer', (payload) => {
    const code = String(payload?.code ?? '').trim()
    const room = rooms.get(code)
    if (!room) return fail(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.')

    const player = room.players.get(socket.data.playerId)
    if (!player || socket.data.roomCode !== code) {
      return fail(socket, 'NOT_IN_ROOM', 'Join the room before answering.')
    }

    const questionIndex = payload?.questionIndex
    const choiceIndex = payload?.choiceIndex
    if (!Number.isInteger(questionIndex) || !Number.isInteger(choiceIndex)) {
      return fail(socket, 'INVALID_ANSWER', 'questionIndex and choiceIndex must be integers.')
    }

    if (room.phase !== 'question' || !room.question) {
      // Answers at or after the deadline are ignored.
      return
    }
    if (questionIndex !== room.question.index) {
      return fail(socket, 'INVALID_ANSWER', 'That question is not the live question.')
    }
    if (choiceIndex < 0 || choiceIndex >= room.question.options.length) {
      return fail(socket, 'INVALID_CHOICE', 'choiceIndex is outside the current options.')
    }
    if (!eligible(room, player)) {
      return fail(socket, 'NOT_ELIGIBLE', 'You joined during this question; scoring starts next.')
    }
    if (Date.now() >= room.qEndsAt) return

    if (recordAnswer(room, player, choiceIndex, Date.now())) {
      log(`room ${code} answer`, player.nickname, choiceIndex)
    }
  })

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      if (room.hostSockets.delete(socket.id)) log('host left', room.code)
      for (const player of room.players.values()) {
        if (player.socketId !== socket.id) continue

        if (room.phase === 'lobby') {
          room.players.delete(player.id)
          showLobby(room)
        } else {
          player.socketId = null
        }
        log('player left', room.code, player.nickname)
      }
    }
  })
})

httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[mock] port ${PORT} is already in use. Stop the other process or run: MOCK_PORT=4100 npm run mock`,
    )
    process.exit(1)
  }
  throw error
})

httpServer.listen(PORT, () => {
  log(`mock server on http://localhost:${PORT}`)
  log(`REST + Socket.IO ready · demo quiz: ${DEMO_QUIZ.title}`)
  log('health check: /health')
})
