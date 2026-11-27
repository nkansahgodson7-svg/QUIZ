import { io } from 'socket.io-client'
import type { GameSocket } from './contract'

/**
 * Defaults to the host that served this page, so LAN clients reach the same
 * server with no configuration. Override with VITE_SERVER_URL if needed.
 */
const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim()

export const SERVER_URL =
  configured || (typeof window === 'undefined' ? 'http://localhost:4000' : window.location.origin)

export function createSocket(): GameSocket {
  return io(SERVER_URL, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnectionDelay: 600,
    reconnectionDelayMax: 3000,
  })
}
