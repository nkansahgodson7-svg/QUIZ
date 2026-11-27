import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config as defaultConfig } from './config.js';
import { isDbConnected } from './db.js';
import { requireLoopback } from './loopback.js';
import { getLanAddress } from './network.js';
import quizzesRouter from './routes/quizzes.js';
import sessionsRouter from './routes/sessions.js';

function corsOriginOption(raw) {
  if (raw === '*') return true;
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function isReservedPath(urlPath) {
  return (
    urlPath === '/api'
    || urlPath.startsWith('/api/')
    || urlPath === '/socket.io'
    || urlPath.startsWith('/socket.io/')
  );
}

export function createApp(config = defaultConfig) {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors({ origin: corsOriginOption(config.corsOrigin) }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    const connected = isDbConnected();
    return res.status(connected ? 200 : 503).json({
      ok: connected,
      db: connected ? 'connected' : 'disconnected',
    });
  });

  app.get('/api/server-info', requireLoopback, (req, res) => {
    const port = req.socket.localPort ?? config.port;
    const lanAddress = getLanAddress();
    return res.json({
      lanUrl: `http://${lanAddress ?? '127.0.0.1'}:${port}`,
      port,
    });
  });

  app.use('/api/quizzes', requireLoopback, quizzesRouter);
  app.use('/api/sessions', requireLoopback, sessionsRouter);

  const indexFile = path.join(config.clientDir, 'index.html');
  const hasClient = fs.existsSync(indexFile);

  if (hasClient) {
    app.use(express.static(config.clientDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (isReservedPath(req.path)) return next();
      return res.sendFile(indexFile, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found.' });
  });

  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
      return res.status(400).json({ code: 'INVALID_JSON', message: 'Request body is not valid JSON.' });
    }
    console.error('Unhandled HTTP error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on the server.',
    });
  });

  return app;
}
