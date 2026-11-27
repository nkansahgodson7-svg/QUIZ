import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let db = null;
let dbPath = null;

function requireDb() {
  if (!db) throw new Error('Database is not connected.');
  return db;
}

function toIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function quizFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    questions: JSON.parse(row.questions_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function sessionSummaryFromRow(row) {
  return {
    id: row.id,
    quizId: row.quiz_id,
    quizTitle: row.quiz_title,
    code: row.code,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    playerCount: JSON.parse(row.players_json).length,
  };
}

function sessionFromRow(row) {
  return {
    id: row.id,
    quizId: row.quiz_id,
    quizTitle: row.quiz_title,
    code: row.code,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    players: JSON.parse(row.players_json),
  };
}

export function connectDb(filePath) {
  if (db && dbPath === filePath) return db;
  if (db) {
    db.close();
    db = null;
    dbPath = null;
  }

  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  db = new DatabaseSync(filePath);
  dbPath = filePath;
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS quizzes_updated_at_idx
      ON quizzes (updated_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      quiz_title TEXT NOT NULL,
      code TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      players_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_ended_at_idx
      ON sessions (ended_at DESC);
  `);

  return db;
}

export function disconnectDb() {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function isDbConnected() {
  return db !== null;
}

export function listQuizzes() {
  return requireDb()
    .prepare('SELECT * FROM quizzes ORDER BY updated_at DESC, rowid DESC')
    .all()
    .map(quizFromRow);
}

export function getQuiz(id) {
  if (typeof id !== 'string' || !id) return null;
  const row = requireDb().prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
  return row ? quizFromRow(row) : null;
}

export function createQuiz({ title, questions }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  requireDb()
    .prepare(
      `INSERT INTO quizzes (id, title, questions_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, title, JSON.stringify(questions), now, now);
  return getQuiz(id);
}

export function updateQuiz(id, { title, questions }) {
  const result = requireDb()
    .prepare(
      `UPDATE quizzes
       SET title = ?, questions_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(title, JSON.stringify(questions), Date.now(), id);
  return result.changes > 0 ? getQuiz(id) : null;
}

export function deleteQuiz(id) {
  return requireDb().prepare('DELETE FROM quizzes WHERE id = ?').run(id).changes > 0;
}

export function listSessions() {
  return requireDb()
    .prepare('SELECT * FROM sessions ORDER BY ended_at DESC, rowid DESC')
    .all()
    .map(sessionSummaryFromRow);
}

export function getSession(id) {
  if (typeof id !== 'string' || !id) return null;
  const row = requireDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  return row ? sessionFromRow(row) : null;
}

export function createSession({
  id = crypto.randomUUID(),
  quizId,
  quizTitle,
  code,
  startedAt,
  endedAt,
  players,
}) {
  const started = startedAt instanceof Date ? startedAt.getTime() : Number(startedAt);
  const ended = endedAt instanceof Date ? endedAt.getTime() : Number(endedAt);

  requireDb()
    .prepare(
      `INSERT INTO sessions
        (id, quiz_id, quiz_title, code, started_at, ended_at, players_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      String(quizId),
      quizTitle,
      code,
      started,
      ended,
      JSON.stringify(players),
    );

  return getSession(id);
}
