const MAX_NICKNAME_LENGTH = 24;

export function cleanNickname(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_NICKNAME_LENGTH) return null;
  return trimmed;
}

export function uniqueNickname(players, desired) {
  const taken = new Set(Array.from(players, (player) => player.nickname.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;

  let suffix = 2;
  while (taken.has(`${desired}${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${desired}${suffix}`;
}
