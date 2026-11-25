import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Host } from '../models/Host.js';
import { requireHost, signHostToken } from '../auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { error: 'Enter a valid email address.' };
  }
  if (password.length < 6 || password.length > 200) {
    return { error: 'Password must be 6 to 200 characters.' };
  }
  return { email, password };
}

router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const credentials = readCredentials(req.body);
    if (credentials.error) {
      return res.status(400).json({ code: 'INVALID_CREDENTIALS', message: credentials.error });
    }

    const existing = await Host.findOne({ email: credentials.email });
    if (existing) {
      return res.status(409).json({
        code: 'EMAIL_TAKEN',
        message: 'An account with that email already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(credentials.password, 10);
    let host;
    try {
      host = await Host.create({ email: credentials.email, passwordHash });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          code: 'EMAIL_TAKEN',
          message: 'An account with that email already exists.',
        });
      }
      throw error;
    }

    return res.status(201).json({
      token: signHostToken(host._id),
      host: host.toJSON(),
    });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const credentials = readCredentials(req.body);
    if (credentials.error) {
      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }

    const host = await Host.findOne({ email: credentials.email });
    const valid = host ? await bcrypt.compare(credentials.password, host.passwordHash) : false;
    if (!valid) {
      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }

    return res.json({
      token: signHostToken(host._id),
      host: host.toJSON(),
    });
  }),
);

router.get(
  '/me',
  requireHost,
  asyncHandler(async (req, res) => {
    const host = await Host.findById(req.hostId);
    if (!host) {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'That account no longer exists.',
      });
    }
    return res.json({ host: host.toJSON() });
  }),
);

export default router;
