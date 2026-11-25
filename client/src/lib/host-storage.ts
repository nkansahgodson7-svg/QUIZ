const KEY = 'quizzly.hostToken'

export function loadHostToken(): string {
  try {
    return localStorage.getItem(KEY)?.trim() || ''
  } catch {
    return ''
  }
}

export function saveHostToken(token: string) {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    /* storage can be unavailable in private mode; the token still works this session */
  }
}
