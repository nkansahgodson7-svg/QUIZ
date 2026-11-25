import { Router } from 'express';
import mongoose from 'mongoose';
import { Quiz } from '../models/Quiz.js';
import { requireHost } from '../auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normalizeQuizInput, ValidationError } from '../utils/quizInput.js';

const router = Router();
router.use(requireHost);

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

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const quizzes = await Quiz.find({ hostId: req.hostId }).sort({ updatedAt: -1 });
    return res.json({ quizzes });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = readInput(req, res);
    if (!input) return undefined;

    const quiz = await Quiz.create({ hostId: req.hostId, ...input });
    return res.status(201).json({ quiz });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ code: 'QUIZ_NOT_FOUND', message: 'Quiz not found.' });
    }

    const quiz = await Quiz.findOne({ _id: req.params.id, hostId: req.hostId });
    if (!quiz) {
      return res.status(404).json({ code: 'QUIZ_NOT_FOUND', message: 'Quiz not found.' });
    }
    return res.json({ quiz });
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ code: 'QUIZ_NOT_FOUND', message: 'Quiz not found.' });
    }

    const quiz = await Quiz.findOne({ _id: req.params.id, hostId: req.hostId });
    if (!quiz) {
      return res.status(404).json({ code: 'QUIZ_NOT_FOUND', message: 'Quiz not found.' });
    }

    const input = readInput(req, res);
    if (!input) return undefined;

    quiz.title = input.title;
    quiz.questions = input.questions;
    await quiz.save();
    return res.json({ quiz });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ code: 'QUIZ_NOT_FOUND', message: 'Quiz not found.' });
    }

    const result = await Quiz.deleteOne({ _id: req.params.id, hostId: req.hostId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ code: 'QUIZ_NOT_FOUND', message: 'Quiz not found.' });
    }
    return res.json({ ok: true });
  }),
);

export default router;
