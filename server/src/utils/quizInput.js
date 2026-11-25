export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const TYPE_ALIASES = new Map([
  ['multiple_choice', 'multiple_choice'],
  ['multiple-choice', 'multiple_choice'],
  ['multiplechoice', 'multiple_choice'],
  ['mc', 'multiple_choice'],
  ['true_false', 'true_false'],
  ['true-false', 'true_false'],
  ['truefalse', 'true_false'],
  ['tf', 'true_false'],
  ['boolean', 'true_false'],
]);

function requireText(value, field, maxLength) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${field} cannot be empty.`);
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function requireInteger(value, field, min, max) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ValidationError(`${field} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function normalizeQuestion(question, position) {
  if (!question || typeof question !== 'object') {
    throw new ValidationError(`Question ${position + 1} is invalid.`);
  }

  const type = TYPE_ALIASES.get(String(question.type || '').trim().toLowerCase());
  if (!type) {
    throw new ValidationError(
      `Question ${position + 1} type must be "multiple_choice" or "true_false".`,
    );
  }

  const text = requireText(question.text, `Question ${position + 1} text`, 1000);
  const durationSec = question.durationSec === undefined || question.durationSec === null
    ? 20
    : requireInteger(question.durationSec, `Question ${position + 1} durationSec`, 1, 300);

  if (type === 'true_false') {
    const correctIndex = requireInteger(
      question.correctIndex,
      `Question ${position + 1} correctIndex`,
      0,
      1,
    );
    return {
      type,
      text,
      options: ['True', 'False'],
      correctIndex,
      durationSec,
    };
  }

  if (!Array.isArray(question.options)) {
    throw new ValidationError(`Question ${position + 1} options must be an array.`);
  }
  if (question.options.length < 2 || question.options.length > 4) {
    throw new ValidationError(`Question ${position + 1} must have 2 to 4 options.`);
  }

  const options = question.options.map((option, optionIndex) => {
    if (typeof option !== 'string') {
      throw new ValidationError(
        `Question ${position + 1} option ${optionIndex + 1} must be a string.`,
      );
    }
    const trimmed = option.trim();
    if (!trimmed) {
      throw new ValidationError(
        `Question ${position + 1} option ${optionIndex + 1} cannot be empty.`,
      );
    }
    if (trimmed.length > 200) {
      throw new ValidationError(
        `Question ${position + 1} option ${optionIndex + 1} is too long.`,
      );
    }
    return trimmed;
  });

  const correctIndex = requireInteger(
    question.correctIndex,
    `Question ${position + 1} correctIndex`,
    0,
    options.length - 1,
  );

  return { type, text, options, correctIndex, durationSec };
}

export function normalizeQuizInput(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be an object.');
  }

  const title = requireText(body.title, 'title', 120);
  if (!Array.isArray(body.questions)) {
    throw new ValidationError('questions must be an array.');
  }
  if (body.questions.length < 1) {
    throw new ValidationError('A quiz needs at least one question.');
  }
  if (body.questions.length > 100) {
    throw new ValidationError('A quiz can have at most 100 questions.');
  }

  return {
    title,
    questions: body.questions.map(normalizeQuestion),
  };
}
