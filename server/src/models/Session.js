import mongoose from 'mongoose';

const answerSchema = new mongoose.Schema(
  {
    questionIndex: { type: Number, required: true },
    choiceIndex: { type: Number, default: null },
    correct: { type: Boolean, default: false },
    points: { type: Number, default: 0 },
    answeredAt: { type: Date, default: null },
    responseMs: { type: Number, default: null },
  },
  { _id: false },
);

const sessionPlayerSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    nickname: { type: String, required: true },
    totalScore: { type: Number, required: true, default: 0 },
    answers: { type: [answerSchema], default: [] },
  },
  { _id: false },
);

const sessionSchema = new mongoose.Schema(
  {
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Host',
      required: true,
      index: true,
    },
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
      required: true,
    },
    code: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    players: { type: [sessionPlayerSchema], default: [] },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      versionKey: false,
      transform(_doc, ret) {
        ret.id = String(ret._id);
        ret.hostId = String(ret.hostId);
        ret.quizId = String(ret.quizId);
        delete ret._id;
        return ret;
      },
    },
  },
);

sessionSchema.index({ hostId: 1, endedAt: -1 });

export const Session = mongoose.model('Session', sessionSchema);
