import type { QuestionType } from './contract'
import { SERVER_URL } from './socket'

const BASE_URL = SERVER_URL.replace(/\/+$/, '')

export interface ServerInfo {
  lanUrl: string
  port: number
}

export interface QuizQuestion {
  type: QuestionType
  text: string
  options: string[]
  correctIndex: number
  durationSec: number
}

export interface QuizInput {
  title: string
  questions: QuizQuestion[]
}

export interface Quiz extends QuizInput {
  id: string
  createdAt?: string
  updatedAt?: string
}

export interface SessionSummary {
  id: string
  quizId: string
  quizTitle?: string | null
  code: string
  startedAt: string
  endedAt: string
  playerCount: number
}

export interface SessionAnswer {
  questionIndex: number
  choiceIndex: number | null
  correct: boolean
  points: number
  answeredAt: string | null
  responseMs: number | null
}

export interface SessionPlayer {
  playerId: string
  nickname: string
  totalScore: number
  answers: SessionAnswer[]
}

export interface SessionDetail {
  id: string
  quizId: string
  code: string
  startedAt: string
  endedAt: string
  players: SessionPlayer[]
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

function isErrorPayload(value: unknown): value is { code?: string; message?: string } {
  return typeof value === 'object' && value !== null
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(
      'Could not reach the quiz server. Check your connection and try again.',
      'NETWORK_ERROR',
      0,
    )
  }

  const raw = await response.text()
  let payload: unknown = null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const data = isErrorPayload(payload) ? payload : null
    throw new ApiError(
      data?.message || `The server returned ${response.status}.`,
      data?.code || 'REQUEST_FAILED',
      response.status,
    )
  }

  return payload as T
}

export async function fetchServerInfo(): Promise<ServerInfo> {
  return request<ServerInfo>('/api/server-info')
}

export async function fetchQuizzes(): Promise<Quiz[]> {
  const data = await request<{ quizzes: Quiz[] }>('/api/quizzes')
  return data.quizzes
}

export async function fetchQuiz(id: string): Promise<Quiz> {
  const data = await request<{ quiz: Quiz }>(`/api/quizzes/${encodeURIComponent(id)}`)
  return data.quiz
}

export async function createQuiz(input: QuizInput): Promise<Quiz> {
  const data = await request<{ quiz: Quiz }>('/api/quizzes', {
    method: 'POST',
    body: input,
  })
  return data.quiz
}

export async function updateQuiz(id: string, input: QuizInput): Promise<Quiz> {
  const data = await request<{ quiz: Quiz }>(`/api/quizzes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  })
  return data.quiz
}

export async function deleteQuiz(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/quizzes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const data = await request<{ sessions: SessionSummary[] }>('/api/sessions')
  return data.sessions
}

export async function fetchSession(id: string): Promise<SessionDetail> {
  const data = await request<{ session: SessionDetail }>(
    `/api/sessions/${encodeURIComponent(id)}`,
  )
  return data.session
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Try again.'
}
