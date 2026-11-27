import { Router } from 'express';
import {
  createQuiz,
  deleteQuiz,
  getQuiz,
  listQuizzes,
  updateQuiz,
} from '../db.js';
import { normalizeQuizInput, ValidationError } from '../utils/quizInput.js';

const router = Router();

function readInput(req, res) {
  try {
    return normalizeQuizInput(req.body);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: error.message });
      return null;
    }
    throw error;
  }
}

function notFound(res) {
  return res.status(404).json({ code: 'QUIZ_NOT_FOUND', message: 'Quiz not found.' });
}

router.get('/', (_req, res) => {
  return res.json({ quizzes: listQuizzes() });
});

router.post('/', (req, res) => {
  const input = readInput(req, res);
  if (!input) return undefined;

  const quiz = createQuiz(input);
  return res.status(201).json({ quiz });
});

router.get('/:id', (req, res) => {
  const quiz = getQuiz(req.params.id);
  if (!quiz) return notFound(res);
  return res.json({ quiz });
});

router.put('/:id', (req, res) => {
  if (!getQuiz(req.params.id)) return notFound(res);

  const input = readInput(req, res);
  if (!input) return undefined;

  const quiz = updateQuiz(req.params.id, input);
  if (!quiz) return notFound(res);
  return res.json({ quiz });
});

router.delete('/:id', (req, res) => {
  if (!deleteQuiz(req.params.id)) return notFound(res);
  return res.json({ ok: true });
});

export default router;
