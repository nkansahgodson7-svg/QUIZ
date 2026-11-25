/**
 * Mock game server for the client. Implements only the events in CONTRACT.md.
 *
 *   node mock/server.mjs        (or npm run mock)
 *
 * Hosts authenticate on the Socket.IO handshake. There is no REST auth in the
 * mock, so any non-empty token is treated as a valid host token:
 *
 *   io('http://localhost:4000', { auth: { token: 'mock-host-token' } })
 *
 * Rooms live in memory, a 5-question demo quiz runs on timers, and fake players
 * answer so the lobby and leaderboard are populated during development.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'

const PORT = Number(process.env.MOCK_PORT || 4000)
const REVEAL_MS = 5000
const MAX_PLAYERS = 300
const BOT_TARGET = 14

const QUIZ = {
  id: 'demo-quiz',
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

/** @type {Map<string, any>} */
const rooms = new Map()

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, quiz: QUIZ.title }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false }))
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
  if (!token) {
    fail(socket, 'AUTH_REQUIRED', 'Host authentication is required.')
    return null
  }
  return token
}

function newCode() {
  let code
  do {
    code = String(Math.floor(100000 + Math.random() * 900000))
  } while (rooms.has(code))
  return code
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
  const q = QUIZ.questions[room.qIndex]
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
    total: QUIZ.questions.length,
    type: q.type,
    text: q.text,
    options: q.options,
    startsAt: room.qStartsAt,
    durationMs: room.qDurationMs,
  }

  emitQuestionToEveryone(room)
  emitAnswerCount(room)
  log(`room ${room.code} question ${room.qIndex + 1}/${QUIZ.questions.length}`)

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
  const q = QUIZ.questions[room.qIndex]

  for (const player of room.players.values()) {
    const answer = room.answers.get(player.id)
    let points = 0
    if (eligible(room, player) && answer && answer.choiceIndex === q.correctIndex) {
      const timeLeft = room.qEndsAt - answer.at
      points = Math.round((1000 * timeLeft) / room.qDurationMs)
    }
    player.score += points
    player.lastPoints = points
    player.lastAnswer = answer?.choiceIndex ?? null
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
  if (room.qIndex >= QUIZ.questions.length) {
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

  log(`room ${room.code} ended`, `${room.players.size} players`)

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
    const token = requireHost(socket)
    if (!token) return

    const quizId = String(payload?.quizId ?? '').trim()
    if (quizId !== QUIZ.id) {
      return fail(socket, 'QUIZ_NOT_FOUND', 'Quiz not found for this host.')
    }
    if (QUIZ.questions.length === 0) {
      return fail(socket, 'QUIZ_EMPTY', 'That quiz has no questions.')
    }

    const code = newCode()
    const room = {
      code,
      quizId,
      hostToken: token,
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
    const token = requireHost(socket)
    if (!token) return

    const code = String(payload?.code ?? '').trim()
    const room = rooms.get(code)
    if (!room) return fail(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.')
    if (!room.hostSockets.has(socket.id)) {
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
  log(`mock server on http://localhost:${PORT}  (quiz: ${QUIZ.title})`)
  log('health check: /health')
})
