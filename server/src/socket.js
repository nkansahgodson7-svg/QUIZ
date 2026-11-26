import mongoose from 'mongoose';
import { Quiz } from './models/Quiz.js';
import { verifyHostToken } from './auth.js';
import { CLIENT_EVENTS, SERVER_EVENTS } from './game/events.js';
import { GameError } from './game/GameRoom.js';

function emitError(socket, code, message) {
  socket.emit(SERVER_EVENTS.ERROR, { code, message });
}

function handleError(socket, error) {
  if (error instanceof GameError) {
    emitError(socket, error.code, error.message);
    return;
  }
  console.error('Socket handler error:', error);
  emitError(socket, 'INTERNAL_ERROR', 'Something went wrong on the server.');
}

function safeHandler(socket, handler) {
  return async function wrapped(...args) {
    try {
      await handler(...args);
    } catch (error) {
      handleError(socket, error);
    }
  };
}

function readHandshakeToken(socket) {
  const raw = socket.handshake.auth?.token ?? socket.handshake.query?.token;
  if (Array.isArray(raw)) return raw[0] ?? null;
  if (typeof raw !== 'string') return null;
  return raw.replace(/^Bearer\s+/i, '').trim() || null;
}

export function attachSocketHandlers(io, rooms) {
  io.use((socket, next) => {
    const token = readHandshakeToken(socket);
    if (token) {
      try {
        socket.data.hostId = verifyHostToken(token);
      } catch {
        socket.data.hostId = null;
      }
    } else {
      socket.data.hostId = null;
    }
    next();
  });

  io.on('connection', (socket) => {
    socket.data.hostRooms = new Set();
    socket.data.playerRooms = new Map();

    function requireHost() {
      if (!socket.data.hostId) {
        emitError(socket, 'AUTH_REQUIRED', 'Host authentication is required. Connect with a host token.');
        return false;
      }
      return true;
    }

    socket.on(
      CLIENT_EVENTS.HOST_CREATE_ROOM,
      safeHandler(socket, async (payload) => {
        if (!requireHost()) return;

        const quizId = payload?.quizId;
        if (typeof quizId !== 'string' || !mongoose.isValidObjectId(quizId)) {
          emitError(socket, 'QUIZ_NOT_FOUND', 'Quiz not found.');
          return;
        }

        const quiz = await Quiz.findOne({ _id: quizId, hostId: socket.data.hostId });
        if (!quiz) {
          emitError(socket, 'QUIZ_NOT_FOUND', 'Quiz not found.');
          return;
        }
        if (quiz.questions.length === 0) {
          emitError(socket, 'QUIZ_EMPTY', 'Add at least one question before opening a room.');
          return;
        }

        const room = rooms.createRoom({
          quiz: quiz.toObject(),
          hostId: socket.data.hostId,
          hostSocketId: socket.id,
        });

        socket.join(room.code);
        socket.data.hostRooms.add(room.code);
        socket.emit(SERVER_EVENTS.ROOM_CREATED, { code: room.code });
        room.emitLobbyUpdate();
      }),
    );

    socket.on(
      CLIENT_EVENTS.HOST_START,
      safeHandler(socket, (payload) => {
        if (!requireHost()) return;

        const room = rooms.getRoom(payload?.code);
        if (!room) {
          emitError(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.');
          return;
        }
        if (room.hostId !== socket.data.hostId) {
          emitError(socket, 'NOT_HOST', 'Only this room\'s host can start the game.');
          return;
        }
        if (room.state === 'ended') {
          emitError(socket, 'GAME_ENDED', 'That game has already ended.');
          return;
        }
        if (room.state !== 'lobby') {
          emitError(socket, 'ALREADY_STARTED', 'That game has already started.');
          return;
        }

        socket.join(room.code);
        socket.data.hostRooms.add(room.code);
        room.attachHost(socket.id);
        room.start();
      }),
    );

    socket.on(
      CLIENT_EVENTS.PLAYER_JOIN,
      safeHandler(socket, (payload) => {
        const room = rooms.getRoom(payload?.code);
        if (!room) {
          emitError(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.');
          return;
        }
        if (socket.data.playerRooms.has(room.code)) {
          emitError(socket, 'ALREADY_JOINED', 'You are already in that room.');
          return;
        }

        const player = room.addPlayer({ nickname: payload?.nickname, socketId: socket.id });
        socket.join(room.code);
        socket.data.playerRooms.set(room.code, player.id);

        socket.emit(SERVER_EVENTS.PLAYER_JOINED, {
          playerId: player.id,
          nickname: player.nickname,
          playerToken: player.token,
        });

        if (room.state === 'lobby') room.emitLobbyUpdate();

        const currentQuestion = room.currentQuestionPayload(player.id);
        if (currentQuestion) socket.emit(SERVER_EVENTS.GAME_QUESTION, currentQuestion);
      }),
    );

    socket.on(
      CLIENT_EVENTS.PLAYER_REJOIN,
      safeHandler(socket, (payload) => {
        const room = rooms.getRoom(payload?.code);
        if (!room) {
          emitError(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.');
          return;
        }

        const { player, previousSocketId } = room.rejoinPlayer({
          playerToken: payload?.playerToken,
          socketId: socket.id,
        });

        socket.join(room.code);
        socket.data.playerRooms.set(room.code, player.id);

        if (previousSocketId && previousSocketId !== socket.id) {
          io.sockets.sockets.get(previousSocketId)?.disconnect(true);
        }

        socket.emit(SERVER_EVENTS.PLAYER_JOINED, {
          playerId: player.id,
          nickname: player.nickname,
          playerToken: player.token,
        });

        if (room.state === 'lobby') room.emitLobbyUpdate();

        const currentQuestion = room.currentQuestionPayload(player.id);
        if (currentQuestion) {
          socket.emit(SERVER_EVENTS.GAME_QUESTION, currentQuestion);
        } else if (
          room.state === 'reveal'
          && player.lastResult
          && player.lastResult.index === room.currentIndex
        ) {
          socket.emit(SERVER_EVENTS.QUESTION_RESULT, player.lastResult);
        }
      }),
    );

    socket.on(
      CLIENT_EVENTS.PLAYER_ANSWER,
      safeHandler(socket, (payload) => {
        const room = rooms.getRoom(payload?.code);
        if (!room) {
          emitError(socket, 'ROOM_NOT_FOUND', 'Room not found. Check the code.');
          return;
        }

        const playerId = socket.data.playerRooms.get(room.code);
        if (!playerId) {
          emitError(socket, 'NOT_IN_ROOM', 'Join the room before answering.');
          return;
        }

        const questionIndex = payload?.questionIndex;
        const choiceIndex = payload?.choiceIndex;
        if (!Number.isInteger(questionIndex) || !Number.isInteger(choiceIndex)) {
          emitError(socket, 'INVALID_ANSWER', 'questionIndex and choiceIndex must be integers.');
          return;
        }

        const result = room.recordAnswer({ playerId, questionIndex, choiceIndex });
        if (!result.accepted && result.reason === 'NOT_ELIGIBLE') {
          emitError(socket, 'NOT_ELIGIBLE', 'You can start scoring from the next question.');
        }
      }),
    );

    socket.on('disconnect', () => {
      for (const code of socket.data.hostRooms) {
        rooms.getRoom(code)?.detachHost(socket.id);
      }

      for (const [code, playerId] of socket.data.playerRooms) {
        const room = rooms.getRoom(code);
        if (!room) continue;
        const { removed } = room.markPlayerDisconnected(playerId, socket.id);
        if (removed) room.emitLobbyUpdate();
      }
    });
  });
}
