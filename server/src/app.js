import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { config } from './config.js';
import authRouter from './routes/auth.js';
import quizzesRouter from './routes/quizzes.js';
import sessionsRouter from './routes/sessions.js';

function corsOriginOption() {
  if (config.corsOrigin === '*') return true;
  return config.corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors({ origin: corsOriginOption() }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    return res.status(connected ? 200 : 503).json({
      ok: connected,
      db: connected ? 'connected' : 'disconnected',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/quizzes', quizzesRouter);
  app.use('/api/sessions', sessionsRouter);

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
