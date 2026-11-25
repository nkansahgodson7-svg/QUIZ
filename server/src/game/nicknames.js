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
  for (;;) {
    const suffixText = String(suffix);
    const base = desired.slice(0, MAX_NICKNAME_LENGTH - suffixText.length);
    const candidate = `${base}${suffixText}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    suffix += 1;
  }
}
