import type { QuestionType } from './contract'
import { clearHostToken } from './host-storage'
import { SERVER_URL } from './socket'

const BASE_URL = SERVER_URL.replace(/\/+$/, '')

export interface HostAccount {
  id: string
  email: string
  createdAt?: string
}

export interface AuthResponse {
  token: string
  host: HostAccount
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
  hostId: string
  createdAt?: string
  updatedAt?: string
}

export interface SessionSummary {
  id: string
  quizId: string
  /** Present once the server includes the quiz title in the results list. */
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
  hostId: string
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
  token?: string | null
  body?: unknown
}

function isErrorPayload(value: unknown): value is { code?: string; message?: string } {
  return typeof value === 'object' && value !== null
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers.Authorization = `Bearer ${options.token}`

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
    if (response.status === 401) clearHostToken()
    const data = isErrorPayload(payload) ? payload : null
    throw new ApiError(
      data?.message || `The server returned ${response.status}.`,
      data?.code || 'REQUEST_FAILED',
      response.status,
    )
  }

  return payload as T
}

export async function signup(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/signup', {
    method: 'POST',
    body: { email, password },
  })
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

export async function fetchMe(token: string): Promise<HostAccount> {
  const data = await request<{ host: HostAccount }>('/api/auth/me', { token })
  return data.host
}

export async function fetchQuizzes(token: string): Promise<Quiz[]> {
  const data = await request<{ quizzes: Quiz[] }>('/api/quizzes', { token })
  return data.quizzes
}

export async function fetchQuiz(token: string, id: string): Promise<Quiz> {
  const data = await request<{ quiz: Quiz }>(`/api/quizzes/${encodeURIComponent(id)}`, { token })
  return data.quiz
}

export async function createQuiz(token: string, input: QuizInput): Promise<Quiz> {
  const data = await request<{ quiz: Quiz }>('/api/quizzes', {
    method: 'POST',
    token,
    body: input,
  })
  return data.quiz
}

export async function updateQuiz(token: string, id: string, input: QuizInput): Promise<Quiz> {
  const data = await request<{ quiz: Quiz }>(`/api/quizzes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    token,
    body: input,
  })
  return data.quiz
}

export async function deleteQuiz(token: string, id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/quizzes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  })
}

export async function fetchSessions(token: string): Promise<SessionSummary[]> {
  const data = await request<{ sessions: SessionSummary[] }>('/api/sessions', { token })
  return data.sessions
}

export async function fetchSession(token: string, id: string): Promise<SessionDetail> {
  const data = await request<{ session: SessionDetail }>(
    `/api/sessions/${encodeURIComponent(id)}`,
    { token },
  )
  return data.session
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Try again.'
}
