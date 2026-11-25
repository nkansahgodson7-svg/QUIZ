import { io } from 'socket.io-client'
import type { GameSocket } from './contract'

/**
 * Switch to the real game server with one env var:
 *   VITE_SERVER_URL=https://quiz-api.example.com
 */
export const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() || 'http://localhost:4000'

export const IS_DEFAULT_SERVER = SERVER_URL === 'http://localhost:4000'

export function createSocket(options: { token?: string } = {}): GameSocket {
  return io(SERVER_URL, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnectionDelay: 600,
    reconnectionDelayMax: 3000,
    auth: options.token ? { token: options.token } : undefined,
  })
}
