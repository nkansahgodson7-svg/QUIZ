import { Router } from 'express';
import { getSession, listSessions } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  return res.json({ sessions: listSessions() });
});

router.get('/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
  }
  return res.json({ session });
});

export default router;
