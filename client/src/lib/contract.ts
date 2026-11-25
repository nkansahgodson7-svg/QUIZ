import type { Socket } from 'socket.io-client'

/** Wire types for the final contract in CONTRACT.md. */
export type QuestionType = 'multiple_choice' | 'true_false'

export interface GameQuestion {
  index: number
  total: number
  type: QuestionType
  text: string
  options: string[]
  startsAt: number
  durationMs: number
  /** Latest server-received answer for this question; always null for hosts. */
  myChoiceIndex: number | null
}

export interface JoinedPayload {
  playerId: string
  nickname: string
  playerToken: string
}

export interface LobbyUpdate {
  playerCount: number
}

export interface LeaderboardEntry {
  playerId: string
  nickname: string
  totalScore: number
  rank: number
}

export interface PlayerResult {
  index: number
  correctIndex: number
  points: number
  totalScore: number
  rank: number
  top5: LeaderboardEntry[]
}

export interface AnswerCount {
  index: number
  answered: number
  total: number
}

export interface PlayerGameEnded {
  yourRank: number
  yourScore: number
  top5: LeaderboardEntry[]
}

export interface HostGameEnded {
  leaderboard: LeaderboardEntry[]
}

export type GameEndedPayload = PlayerGameEnded | HostGameEnded

export interface GameError {
  code: string
  message: string
}

export interface ServerToClientEvents {
  'room:created': (payload: { code: string }) => void
  'player:joined': (payload: JoinedPayload) => void
  'lobby:update': (payload: LobbyUpdate) => void
  'game:question': (payload: GameQuestion) => void
  'game:answer_count': (payload: AnswerCount) => void
  'question:result': (payload: PlayerResult) => void
  'game:ended': (payload: GameEndedPayload) => void
  error: (payload: GameError) => void
}

export interface ClientToServerEvents {
  'host:create_room': (payload: { quizId: string }) => void
  'host:start': (payload: { code: string }) => void
  'player:join': (payload: { code: string; nickname: string }) => void
  'player:rejoin': (payload: { code: string; playerToken: string }) => void
  'player:answer': (payload: { code: string; questionIndex: number; choiceIndex: number }) => void
}

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

/** The leaderboard UI uses the same exact entry shape as the wire. */
export type LeaderRow = LeaderboardEntry

export function isPlayerGameEnded(payload: GameEndedPayload): payload is PlayerGameEnded {
  return 'yourRank' in payload
}

export function isHostGameEnded(payload: GameEndedPayload): payload is HostGameEnded {
  return 'leaderboard' in payload
}
