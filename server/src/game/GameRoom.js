import crypto from 'node:crypto';
import { SERVER_EVENTS } from './events.js';
import { buildLeaderboard, calculatePoints, topFive } from './scoring.js';
import { cleanNickname, uniqueNickname } from './nicknames.js';

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

export class GameRoom {
  constructor({
    code,
    hostId,
    hostSocketId,
    quiz,
    io,
    revealMs = 5000,
    maxPlayers = 1000,
    onGameEnd = null,
  }) {
    this.code = code;
    this.hostId = String(hostId);
    this.hostSocketId = hostSocketId;
    this.quizId = String(quiz._id ?? quiz.id);
    this.quiz = {
      id: this.quizId,
      title: quiz.title,
      questions: quiz.questions.map((question) => ({
        type: question.type,
        text: question.text,
        options: [...question.options],
        correctIndex: question.correctIndex,
        durationSec: question.durationSec,
      })),
    };
    this.io = io;
    this.revealMs = revealMs;
    this.maxPlayers = maxPlayers;
    this.onGameEnd = onGameEnd;

    this.state = 'lobby';
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.currentIndex = -1;
    this.currentQuestion = null;
    this.players = new Map();
    this.tokens = new Map();
    this.joinCounter = 0;
    this.questionTimer = null;
    this.revealTimer = null;
  }

  get playerCount() {
    return this.players.size;
  }

  get isActive() {
    return this.state === 'question' || this.state === 'reveal';
  }

  attachHost(socketId) {
    this.hostSocketId = socketId;
  }

  detachHost(socketId) {
    if (this.hostSocketId === socketId) this.hostSocketId = null;
  }

  emitToHost(event, payload) {
    if (!this.hostSocketId) return;
    this.io.to(this.hostSocketId).emit(event, payload);
  }

  emitLobbyUpdate() {
    this.emitToHost(SERVER_EVENTS.LOBBY_UPDATE, { playerCount: this.playerCount });
  }

  addPlayer({ nickname, socketId }) {
    if (this.state === 'ended') {
      throw new GameError('GAME_ENDED', 'That game has already ended.');
    }
    if (this.players.size >= this.maxPlayers) {
      throw new GameError('ROOM_FULL', 'That room is full.');
    }

    const desired = cleanNickname(nickname);
    if (!desired) {
      throw new GameError(
        'INVALID_NICKNAME',
        'Choose a nickname between 1 and 24 characters.',
      );
    }

    const player = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('hex'),
      nickname: uniqueNickname(this.players.values(), desired),
      socketId,
      connected: true,
      joinedAt: Date.now(),
      joinOrder: this.joinCounter++,
      totalScore: 0,
      answers: new Map(),
      lastResult: null,
      eligibleFromIndex: this.currentIndex + 1,
    };

    this.players.set(player.id, player);
    this.tokens.set(player.token, player);
    return player;
  }

  rejoinPlayer({ playerToken, socketId }) {
    if (this.state === 'ended') {
      throw new GameError('GAME_ENDED', 'That game has already ended.');
    }

    const player = typeof playerToken === 'string' ? this.tokens.get(playerToken) : undefined;
    if (!player) {
      throw new GameError(
        'INVALID_PLAYER_TOKEN',
        'That player session is no longer available. Join again with your nickname.',
      );
    }

    const previousSocketId = player.socketId;
    player.socketId = socketId;
    player.connected = true;
    return { player, previousSocketId };
  }

  markPlayerDisconnected(playerId, socketId) {
    const player = this.players.get(playerId);
    if (!player || player.socketId !== socketId) {
      return { changed: false, removed: false };
    }

    if (this.state === 'lobby') {
      this.players.delete(player.id);
      this.tokens.delete(player.token);
      return { changed: true, removed: true };
    }

    player.connected = false;
    player.socketId = null;
    return { changed: true, removed: false };
  }

  start() {
    if (this.state === 'ended') {
      throw new GameError('GAME_ENDED', 'That game has already ended.');
    }
    if (this.state !== 'lobby') {
      throw new GameError('ALREADY_STARTED', 'That game has already started.');
    }
    if (this.quiz.questions.length === 0) {
      throw new GameError('QUIZ_EMPTY', 'This quiz has no questions.');
    }

    this.startedAt = Date.now();
    this.currentIndex = 0;
    this._startCurrentQuestion();
  }

  recordAnswer({ playerId, questionIndex, choiceIndex }) {
    const player = this.players.get(playerId);
    if (!player) {
      throw new GameError('NOT_IN_ROOM', 'Join the room before answering.');
    }

    if (this.state !== 'question' || !this.currentQuestion) {
      return { accepted: false, reason: 'QUESTION_CLOSED' };
    }
    if (questionIndex !== this.currentIndex) {
      return { accepted: false, reason: 'STALE_QUESTION' };
    }

    const now = Date.now();
    if (now >= this.currentQuestion.endsAt) {
      return { accepted: false, reason: 'QUESTION_CLOSED' };
    }
    if (player.eligibleFromIndex > this.currentIndex) {
      return { accepted: false, reason: 'NOT_ELIGIBLE' };
    }

    const question = this.quiz.questions[this.currentIndex];
    if (
      !Number.isInteger(choiceIndex)
      || choiceIndex < 0
      || choiceIndex >= question.options.length
    ) {
      throw new GameError('INVALID_CHOICE', 'That answer choice is not valid.');
    }

    this.currentQuestion.answers.set(player.id, {
      choiceIndex,
      receivedAt: now,
    });
    this._emitAnswerCount();
    return { accepted: true };
  }

  currentQuestionPayload(playerId = null) {
    if (this.state !== 'question' || !this.currentQuestion) return null;
    const question = this.quiz.questions[this.currentIndex];
    const answer = playerId ? this.currentQuestion.answers.get(playerId) : null;
    return {
      index: this.currentIndex,
      total: this.quiz.questions.length,
      type: question.type,
      text: question.text,
      options: [...question.options],
      startsAt: this.currentQuestion.startsAt,
      durationMs: this.currentQuestion.durationMs,
      myChoiceIndex: answer ? answer.choiceIndex : null,
    };
  }

  _emitAnswerCount() {
    if (!this.currentQuestion) return;
    this.emitToHost(SERVER_EVENTS.GAME_ANSWER_COUNT, {
      index: this.currentIndex,
      answered: this.currentQuestion.answers.size,
      total: this.currentQuestion.eligibleCount,
    });
  }

  _startCurrentQuestion() {
    const question = this.quiz.questions[this.currentIndex];
    if (!question) {
      this._endGame();
      return;
    }

    const startsAt = Date.now();
    const durationMs = Math.max(1, question.durationSec * 1000);

    this.state = 'question';
    // Eligibility is fixed for the duration of a question: players who join
    // later are only eligible from the next question, so count once here.
    let eligibleCount = 0;
    for (const player of this.players.values()) {
      if (player.eligibleFromIndex <= this.currentIndex) eligibleCount += 1;
    }

    this.currentQuestion = {
      index: this.currentIndex,
      startsAt,
      endsAt: startsAt + durationMs,
      durationMs,
      eligibleCount,
      answers: new Map(),
    };

    const basePayload = {
      index: this.currentIndex,
      total: this.quiz.questions.length,
      type: question.type,
      text: question.text,
      options: [...question.options],
      startsAt,
      durationMs,
    };

    this.emitToHost(SERVER_EVENTS.GAME_QUESTION, { ...basePayload, myChoiceIndex: null });
    for (const player of this.players.values()) {
      if (!player.socketId) continue;
      this.io.sockets.sockets.get(player.socketId)?.emit(SERVER_EVENTS.GAME_QUESTION, {
        ...basePayload,
        myChoiceIndex: this.currentQuestion.answers.get(player.id)?.choiceIndex ?? null,
      });
    }

    this._emitAnswerCount();

    this.questionTimer = setTimeout(() => {
      this._endQuestion(this.currentIndex);
    }, durationMs);
  }

  _endQuestion(index) {
    if (this.state !== 'question' || !this.currentQuestion) return;
    if (this.currentQuestion.index !== index) return;

    this.questionTimer = null;
    this.state = 'reveal';

    const questionState = this.currentQuestion;
    const question = this.quiz.questions[index];
    const pointsByPlayer = new Map();

    for (const player of this.players.values()) {
      const answer = questionState.answers.get(player.id) || null;
      let correct = false;
      let points = 0;

      if (answer && player.eligibleFromIndex <= index) {
        correct = answer.choiceIndex === question.correctIndex;
        points = calculatePoints({
          correct,
          receivedAt: answer.receivedAt,
          startsAt: questionState.startsAt,
          durationMs: questionState.durationMs,
        });
      }

      player.totalScore += points;
      player.answers.set(index, {
        questionIndex: index,
        choiceIndex: answer ? answer.choiceIndex : null,
        correct,
        points,
        receivedAt: answer ? answer.receivedAt : null,
        responseMs: answer ? Math.max(0, answer.receivedAt - questionState.startsAt) : null,
      });
      pointsByPlayer.set(player.id, { points, correct });
    }

    const leaderboard = buildLeaderboard(this.players.values());
    const top5 = topFive(leaderboard);
    const rankByPlayer = new Map(leaderboard.map((entry) => [entry.playerId, entry.rank]));

    for (const player of this.players.values()) {
      const result = {
        index,
        correctIndex: question.correctIndex,
        points: pointsByPlayer.get(player.id).points,
        totalScore: player.totalScore,
        rank: rankByPlayer.get(player.id),
        top5,
      };
      player.lastResult = result;

      if (player.socketId) {
        this.io.sockets.sockets.get(player.socketId)?.emit(SERVER_EVENTS.QUESTION_RESULT, result);
      }
    }

    this.revealTimer = setTimeout(() => {
      this._advance();
    }, this.revealMs);
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this.revealTimer = null;

    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.quiz.questions.length) {
      this._endGame();
      return;
    }

    this.currentIndex = nextIndex;
    this._startCurrentQuestion();
  }

  _endGame() {
    if (this.state === 'ended') return;

    this.questionTimer = null;
    this.revealTimer = null;
    this.state = 'ended';
    this.endedAt = Date.now();
    this.currentQuestion = null;

    const leaderboard = buildLeaderboard(this.players.values());
    const top5 = topFive(leaderboard);
    const rankByPlayer = new Map(leaderboard.map((entry) => [entry.playerId, entry.rank]));

    for (const player of this.players.values()) {
      if (!player.socketId) continue;
      this.io.sockets.sockets.get(player.socketId)?.emit(SERVER_EVENTS.GAME_ENDED, {
        yourRank: rankByPlayer.get(player.id),
        yourScore: player.totalScore,
        top5,
      });
    }

    this.emitToHost(SERVER_EVENTS.GAME_ENDED, { leaderboard });

    if (this.onGameEnd) {
      Promise.resolve()
        .then(() => this.onGameEnd(this))
        .catch((error) => {
          console.error(`Failed to save session for room ${this.code}:`, error);
        });
    }
  }

  destroy() {
    if (this.questionTimer) clearTimeout(this.questionTimer);
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.questionTimer = null;
    this.revealTimer = null;
  }
}
