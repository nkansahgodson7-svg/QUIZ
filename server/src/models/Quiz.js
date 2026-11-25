import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['multiple_choice', 'true_false'],
    },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    options: {
      type: [{ type: String, trim: true, maxlength: 200 }],
      required: true,
    },
    correctIndex: { type: Number, required: true, min: 0 },
    durationSec: { type: Number, required: true, default: 20, min: 1, max: 300 },
  },
  { _id: false },
);

const quizSchema = new mongoose.Schema(
  {
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Host',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    questions: { type: [questionSchema], required: true },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform(_doc, ret) {
        ret.id = String(ret._id);
        ret.hostId = String(ret.hostId);
        delete ret._id;
        return ret;
      },
    },
  },
);

quizSchema.index({ hostId: 1, updatedAt: -1 });

export const Quiz = mongoose.model('Quiz', quizSchema);
