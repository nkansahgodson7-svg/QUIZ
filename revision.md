# Quiz Platform — Shared Revision Plan

Reference: [SPEC.md](./SPEC.md) · [CONTRACT.md](./CONTRACT.md)

## 1. Ownership & Boundaries

- **Backend Agent**: owns `/server` only.
- **Frontend Agent**: owns `/client` only.
- **Locked Contracts**: Socket.IO event names and payloads in `CONTRACT.md` are final and must not change. Existing REST route paths and shapes in `/server/src/routes/*` remain stable.

---

## 2. REST API Surface (`/server` → `/client`)

Base URL: `VITE_SERVER_URL` (defaults to `http://localhost:4000` in `client/src/lib/socket.ts`).  
Protected routes require `Authorization: Bearer <token>`. Errors return `{ code, message }`.

### Auth (`/api/auth`)
- `POST /api/auth/signup` `{ email, password }` → `201 { token, host: { id, email, createdAt } }`
- `POST /api/auth/login` `{ email, password }` → `200 { token, host: { id, email, createdAt } }`
- `GET /api/auth/me` → `200 { host: { id, email, createdAt } }`

### Quizzes (`/api/quizzes`)
- `GET /api/quizzes` → `200 { quizzes: Quiz[] }`
- `POST /api/quizzes` `{ title, questions: [{ type: 'multiple_choice' | 'true_false', text, options, correctIndex, durationSec }] }` → `201 { quiz }`
- `GET /api/quizzes/:id` → `200 { quiz }`
- `PUT /api/quizzes/:id` `{ title, questions }` → `200 { quiz }`
- `DELETE /api/quizzes/:id` → `200 { ok: true }`

### Sessions (`/api/sessions`)
- `GET /api/sessions` → `200 { sessions: [{ id, quizId, quizTitle?, code, startedAt, endedAt, playerCount }] }`
- `GET /api/sessions/:id` → `200 { session: { id, hostId, quizId, code, startedAt, endedAt, players: [{ playerId, nickname, totalScore, answers }] } }`

---

## 3. Backend Agent Tasks (`/server`)

1. **Enforce 24-character limit on deduplicated nicknames** (`server/src/game/nicknames.js`)
   - Truncate the base nickname before appending the numeric suffix in `uniqueNickname` so `${base}${suffix}` never exceeds `MAX_NICKNAME_LENGTH` (24).
   - Add a unit test in `server/test/game.test.js` for a 24-character duplicate nickname.

2. **Cache `eligibleCount` per question** (`server/src/game/GameRoom.js`)
   - Compute `eligibleCount` once in `_startCurrentQuestion()` and store it on `this.currentQuestion` instead of scanning `this.players.values()` on every `player:answer` in `_emitAnswerCount()`.

3. **Include `quizTitle` in `GET /api/sessions`** (`server/src/routes/sessions.js`)
   - Use `$lookup` on `quizzes` in the `GET /api/sessions` aggregation so the host results list can display quiz titles even without fetching all quizzes (fallback `null` if deleted). Keep the `Session` Mongoose schema unchanged per `SPEC.md` §7.

4. **Verify tests and 300-player scale**
   - Run `npm test` in `/server` (all tests must pass).
   - Start `npm run dev:memory` and run `node scripts/fake-players.js --players 300 --questions 3 --duration 5` to confirm 300 concurrent players join, answer, score, and save a session cleanly.

---

## 4. Frontend Agent Tasks (`/client`)

1. **Add REST API client** (`client/src/lib/api.ts`)
   - Target `SERVER_URL` from `client/src/lib/socket.ts`.
   - Attach `Authorization: Bearer <token>` and parse `{ code, message }` errors.
   - Clear stored host token on `401`.

2. **Host Authentication** (`client/src/pages/HostPage.tsx` + auth components)
   - Replace the manual JWT input with Sign up / Log in forms (`email` + `password`) backed by `POST /api/auth/signup` and `POST /api/auth/login`.
   - Persist JWT with `host-storage.ts`, verify on load via `GET /api/auth/me`, and add a Log out button.
   - Connect the host Socket.IO client only after authentication.

3. **Saved Quizzes & Quiz Builder** (`SPEC.md` §1, §2)
   - Replace the raw `quizId` text input with a Saved Quizzes list (`GET /api/quizzes`) with **Open Room** (`host:create_room`), **Edit**, and **Delete** (`DELETE /api/quizzes/:id`).
   - Add a Quiz Builder (`POST /api/quizzes`, `PUT /api/quizzes/:id`) supporting:
     - `title`
     - Add/remove/reorder questions
     - `type`: `'multiple_choice'` (2–4 options, 1 `correctIndex`) or `'true_false'` (`['True', 'False']`, `correctIndex` 0 or 1)
     - Per-question `durationSec` (default `20`, range `1–300`)

4. **Past Game Results** (`SPEC.md` §1)
   - Add a Past Results view on `/host` listing completed sessions (`GET /api/sessions`) and inspecting full player leaderboards/scores (`GET /api/sessions/:id`).

5. **Fix Late-Joiner Answer State** (`client/src/pages/PlayerPage.tsx`)
   - Clear `selection` and mark the current question ineligible when the server responds with `error` `code: 'NOT_ELIGIBLE'`, so late joiners do not see `"Locked in"` for a rejected answer.

6. **Verify build & mock compatibility**
   - Keep `client/mock/server.mjs` working for standalone UI development.
   - Run `npm run typecheck && npm run build` in `/client` with 0 errors.
