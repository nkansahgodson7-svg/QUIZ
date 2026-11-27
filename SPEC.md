# Quiz Platform Spec (v2 — Offline LAN)

A minimal, optimized real-time classroom quiz platform that runs **totally offline** on a local network (classroom Wi-Fi router or hotspot with no internet). A host starts the app on their laptop, builds or picks a quiz, and opens a room. Students scan a QR code (or enter the local URL + 6-digit code) on their phones, answer each question against a shared timer, and see live scores and a final leaderboard.

**Stack:** Single-process Node.js (>= 22, built-in `node:sqlite`) + Express + Socket.IO serving a minimal built React + Tailwind client (`client/dist`). Zero external database daemon, zero internet required.

## 1. Architecture & Deployment

- **Single process:** The Node server (`server/`) binds to `0.0.0.0` (default port `4000`), serves the built static frontend (`client/dist`) with SPA fallback, handles REST APIs, and runs Socket.IO.
- **Embedded database:** Built-in `node:sqlite` (`DatabaseSync`) storing data in `./data/quiz.db`. No MongoDB, no separate install.
- **No internet / no PWA dependency:** Students load the app fresh over plain HTTP (`http://<lan-ip>:<port>`) directly from the host's server. No service workers, no cloud fonts/CDNs, no secure-context-only APIs.
- **LAN discovery & QR join:** The server detects its primary LAN IPv4 address (`os.networkInterfaces()`) and exposes `GET /api/server-info` (`{ lanUrl, port }`). The host lobby renders a QR code pointing to `${lanUrl}/?code=${code}` alongside the manual URL and 6-digit code.

## 2. Roles & Access Control

**Host**

- **No signup or login.** Opens `http://localhost:<port>/host` directly into saved quizzes, quiz builder, and past results.
- **LAN Guard:** Host REST routes (`/api/quizzes`, `/api/sessions`, `/api/server-info`) and `host:*` Socket.IO events are restricted to loopback connections (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) so students on the same Wi-Fi cannot access `/host` or trigger host actions.
- Builds, edits, and deletes saved quizzes, opens rooms, starts games, and views/exports saved results.
- Only controls the game. The host does not play and does not score.

**Player**

- No account. Scans the QR code or opens `http://<lan-ip>:<port>` and joins with the 6-digit room code and a nickname.
- If the nickname is already taken in that room (case-insensitive), a number is added automatically (`Kwame`, `Kwame2`).
- Up to 300+ players per room (hardware/Wi-Fi AP permitting).

## 3. Quiz content

- Question types: multiple choice (2 to 4 options, exactly one correct) and true/false.
- Each question has a time limit. Default is 20 seconds; host can override per question.
- Quizzes are built and saved locally in SQLite before a session, then picked when opening a room.

## 4. Game flow

1. **Lobby.** Host opens a room and gets a 6-digit code + QR code. Players join via QR or code + nickname. Host sees the live player count.
2. **Start.** Host presses start. The first question is sent to everyone.
3. **Question.** Every phone shows the full question and options at the same time. One server-controlled timer runs for everyone.
4. **Answering.** A player can change their answer until time runs out. Their score uses the server arrival time of their last tap.
5. **Reveal.** When time runs out, each player sees the correct answer, points earned, and the top 5 for ~5 seconds.
6. **Auto-advance.** The game moves to the next question automatically. No host click is needed.
7. **End.** Final leaderboard is shown and the session is saved to SQLite for the host.

Late joiners can enter after the game has started; they begin scoring from the next question on.

## 5. Timing and scoring

- The server is the only clock (`startsAt`, `durationMs`). Client clocks are never trusted.
- Wrong or missing answer: `0` points.
- Correct answer: `points = round(1000 * timeLeft / durationMs)` where `timeLeft = (startsAt + durationMs) - receivedAt`.
- Countdown does not pause on tap because answers can be changed until the deadline.

## 6. Resilience & Scale (300+ players)

- **Player drops:** Can rejoin with `playerToken` (stored in `localStorage`) to restore nickname, score, and current question state.
- **Host drops:** Game keeps running; auto-advance and SQLite result saving do not depend on the host.
- **Small payloads:** Send each player only their own result + top 5, never the full leaderboard.
- **In-memory room state:** Live room state lives in Node memory during the game and writes to SQLite once at game end.
- **Load test:** Verify 300+ concurrent socket clients with `server/scripts/fake-players.js`.

## 7. Data model (SQLite — `./data/quiz.db`)

- **quizzes**: `id` (TEXT PK), `title` (TEXT), `questions_json` (TEXT), `created_at` (INTEGER), `updated_at` (INTEGER).
- **sessions**: `id` (TEXT PK), `quiz_id` (TEXT), `quiz_title` (TEXT), `code` (TEXT), `started_at` (INTEGER), `ended_at` (INTEGER), `players_json` (TEXT).

## 8. Work split for parallel agents (2 worktrees)

1. **Server agent (`server/`):** Replace MongoDB/Mongoose and JWT auth with `node:sqlite` (`./data/quiz.db`) and loopback-only host guard, add `GET /api/server-info` (LAN IP detection), serve `client/dist` statically with SPA fallback, bind `0.0.0.0`, and keep `server/src/game/*` + Socket.IO contract + tests/load-test passing.
2. **Client agent (`client/`):** Remove host auth (`AuthView.tsx`, JWT token storage) and PWA/Service Worker overhead (`register-sw.ts`, `sw.js`, manifest), add QR code rendering in the host lobby using `GET /api/server-info`, auto-fill `?code=` on the player join screen, and produce a minimal, fast `client/dist` build.
