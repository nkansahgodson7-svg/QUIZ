import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

const corsOrigin = process.env.CORS_ORIGIN || '*';

export const config = Object.freeze({
  port: intFromEnv('PORT', 4000),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.QUIZ_DB_PATH
    ? path.resolve(process.env.QUIZ_DB_PATH)
    : path.join(serverRoot, 'data', 'quiz.db'),
  clientDir: process.env.CLIENT_DIR
    ? path.resolve(process.env.CLIENT_DIR)
    : path.resolve(serverRoot, '..', 'client', 'dist'),
  corsOrigin,
  revealMs: intFromEnv('REVEAL_MS', 5000),
  maxPlayersPerRoom: intFromEnv('MAX_PLAYERS_PER_ROOM', 1000),
  roomTtlMs: intFromEnv('ROOM_TTL_MS', 60 * 60 * 1000),
  lobbyTtlMs: intFromEnv('LOBBY_TTL_MS', 12 * 60 * 60 * 1000),
});
