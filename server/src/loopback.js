const LOOPBACK_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

export function normalizeAddress(value) {
  if (typeof value !== 'string') return '';
  let address = value.trim();
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) address = address.slice(0, zoneIndex);
  return address.toLowerCase();
}

export function isLoopbackAddress(value) {
  return LOOPBACK_ADDRESSES.has(normalizeAddress(value));
}

export function requireLoopback(req, res, next) {
  if (isLoopbackAddress(req.socket?.remoteAddress)) return next();
  return res.status(403).json({
    code: 'AUTH_REQUIRED',
    message: 'Host access is only available from this computer.',
  });
}
