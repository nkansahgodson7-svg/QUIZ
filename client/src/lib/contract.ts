import type { Socket } from 'socket.io-client'

/** Wire types for the socket contract in SPEC.md section 8. */
export type QuestionType = 'multiple_choice' | 'true_false'

export interface GameQuestion {
  index: number
  total: number
  type: QuestionType
  text: string
  options: string[]
  startsAt: number
  durationMs: number
}

export interface JoinedPayload {
  playerId: string
  nickname: string
  playerToken: string
}

export interface LobbyUpdate {
  playerCount: number
}

/** The contract does not pin the shape inside top5[]; accept the common variants. */
export interface LeaderboardEntry {
  rank?: number
  nickname: string
  totalScore?: number
  score?: number
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

export interface GameEndedPayload {
  yourRank?: number
  yourScore?: number
  top5?: LeaderboardEntry[]
  leaderboard?: LeaderboardEntry[]
}

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

export interface LeaderRow {
  rank: number
  nickname: string
  score: number
}

export function normalizeLeaderboard(entries: LeaderboardEntry[] | undefined): LeaderRow[] {
  if (!Array.isArray(entries)) return []
  return entries.map((entry, i) => ({
    rank: entry.rank ?? i + 1,
    nickname: entry.nickname || 'Player',
    score: entry.totalScore ?? entry.score ?? 0,
  }))
}
