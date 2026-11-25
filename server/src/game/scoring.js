export function calculatePoints({ correct, receivedAt, startsAt, durationMs }) {
  if (!correct) return 0;
  if (!Number.isFinite(receivedAt) || !Number.isFinite(startsAt)) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;

  const elapsedMs = receivedAt - startsAt;
  if (elapsedMs <= 0) return 1000;
  if (elapsedMs >= durationMs) return 0;

  return Math.round((1000 * (durationMs - elapsedMs)) / durationMs);
}

export function buildLeaderboard(players) {
  return Array.from(players)
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (a.joinOrder !== b.joinOrder) return a.joinOrder - b.joinOrder;
      return a.nickname.localeCompare(b.nickname);
    })
    .map((player, position) => ({
      playerId: player.id,
      nickname: player.nickname,
      totalScore: player.totalScore,
      rank: position + 1,
    }));
}

export function topFive(leaderboard) {
  return leaderboard.slice(0, 5).map((entry) => ({ ...entry }));
}
