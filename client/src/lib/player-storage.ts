const KEY = 'quizzly.player'

export interface StoredPlayer {
  code: string
  nickname: string
  playerToken: string
}

export function loadStoredPlayer(): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StoredPlayer>
    if (!value.code || !value.playerToken || !value.nickname) return null
    return { code: value.code, nickname: value.nickname, playerToken: value.playerToken }
  } catch {
    return null
  }
}

export function saveStoredPlayer(player: StoredPlayer) {
  try {
    localStorage.setItem(KEY, JSON.stringify(player))
  } catch {
    /* storage can be unavailable in private mode; rejoin is best-effort */
  }
}

export function clearStoredPlayer() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
