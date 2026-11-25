import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function signHostToken(hostId) {
  return jwt.sign(
    { sub: String(hostId), role: 'host' },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

export function verifyHostToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  if (payload?.role !== 'host' || typeof payload.sub !== 'string') {
    throw new Error('Not a host token');
  }
  return payload.sub;
}

export function requireHost(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      code: 'AUTH_REQUIRED',
      message: 'Send an Authorization: Bearer <token> header.',
    });
  }

  try {
    req.hostId = verifyHostToken(token);
    return next();
  } catch {
    return res.status(401).json({
      code: 'INVALID_TOKEN',
      message: 'Your session has expired. Log in again.',
    });
  }
}
