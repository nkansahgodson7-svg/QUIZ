import { createServer as createHttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config as defaultConfig } from './config.js';
import { createApp } from './app.js';
import { attachSocketHandlers } from './socket.js';
import { RoomManager } from './game/RoomManager.js';
import { saveGameSession } from './game/sessionStore.js';

function socketCorsOrigin(raw) {
  if (raw === '*') return true;
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function createQuizServer(options = {}) {
  const config = { ...defaultConfig, ...options };
  const app = createApp();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: { origin: socketCorsOrigin(config.corsOrigin) },
  });

  const roomManager = new RoomManager({
    io,
    revealMs: config.revealMs,
    maxPlayers: config.maxPlayersPerRoom,
    roomTtlMs: config.roomTtlMs,
    lobbyTtlMs: config.lobbyTtlMs,
    onGameEnd: options.onGameEnd || saveGameSession,
  });

  attachSocketHandlers(io, roomManager);

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    roomManager.close();
    await new Promise((resolve) => {
      try {
        io.close(() => resolve());
      } catch {
        resolve();
      }
    });
    if (httpServer.listening) {
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }
  }

  return { app, httpServer, io, roomManager, close };
}
