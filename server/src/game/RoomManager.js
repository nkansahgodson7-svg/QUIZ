import crypto from 'node:crypto';
import { GameRoom } from './GameRoom.js';

export function normalizeRoomCode(value) {
  if (typeof value === 'number' && Number.isInteger(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return /^\d{6}$/.test(code) ? code : null;
}

export class RoomManager {
  constructor({
    io,
    revealMs = 5000,
    maxPlayers = 1000,
    roomTtlMs = 60 * 60 * 1000,
    lobbyTtlMs = 12 * 60 * 60 * 1000,
    onGameEnd = null,
  }) {
    this.io = io;
    this.revealMs = revealMs;
    this.maxPlayers = maxPlayers;
    this.roomTtlMs = roomTtlMs;
    this.lobbyTtlMs = lobbyTtlMs;
    this.onGameEnd = onGameEnd;
    this.rooms = new Map();

    this.cleanupTimer = setInterval(() => this._cleanup(), 10 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  createRoom({ quiz, hostId, hostSocketId }) {
    const code = this._generateCode();
    const room = new GameRoom({
      code,
      quiz,
      hostId,
      hostSocketId,
      io: this.io,
      revealMs: this.revealMs,
      maxPlayers: this.maxPlayers,
      onGameEnd: this.onGameEnd,
    });
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    const normalized = normalizeRoomCode(code);
    return normalized ? this.rooms.get(normalized) : undefined;
  }

  _generateCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate a room code');
  }

  _cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const expiredLobby = room.state === 'lobby' && now - room.createdAt > this.lobbyTtlMs;
      const expiredGame = room.state === 'ended' && now - room.endedAt > this.roomTtlMs;
      if (expiredLobby || expiredGame) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }

  close() {
    clearInterval(this.cleanupTimer);
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
