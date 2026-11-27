import os from 'node:os';

function isIpv4(entry) {
  return entry.family === 'IPv4' || entry.family === 4;
}

export function getLanAddress(interfaces = os.networkInterfaces()) {
  const candidates = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || !isIpv4(entry) || !entry.address) continue;
      candidates.push(entry.address);
    }
  }

  return candidates.find((address) => !address.startsWith('169.254.')) || candidates[0] || null;
}
