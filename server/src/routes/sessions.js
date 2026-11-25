import { Router } from 'express';
import mongoose from 'mongoose';
import { Session } from '../models/Session.js';
import { requireHost } from '../auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(requireHost);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const hostId = new mongoose.Types.ObjectId(req.hostId);
    const sessions = await Session.aggregate([
      { $match: { hostId } },
      { $sort: { endedAt: -1 } },
      {
        $lookup: {
          from: 'quizzes',
          localField: 'quizId',
          foreignField: '_id',
          as: 'quizDoc',
          pipeline: [{ $project: { title: 1 } }],
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          quizId: { $toString: '$quizId' },
          quizTitle: { $ifNull: [{ $arrayElemAt: ['$quizDoc.title', 0] }, null] },
          code: 1,
          startedAt: 1,
          endedAt: 1,
          playerCount: { $size: '$players' },
        },
      },
    ]);
    return res.json({ sessions });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }

    const session = await Session.findOne({ _id: req.params.id, hostId: req.hostId });
    if (!session) {
      return res.status(404).json({ code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }
    return res.json({ session });
  }),
);

export default router;
