# Quiz Platform Server

Offline real-time classroom quiz server. One Node.js process serves the REST API, Socket.IO game engine, and the built React client (`../client/dist`). Data is stored in a local SQLite file using Node's built-in `node:sqlite` — no database daemon, no internet, no accounts.

The authoritative socket event contract is [CONTRACT.md](CONTRACT.md).

The server binds to **`0.0.0.0`** on **port 4000** by default.

## Requirements

- Node.js **22.13+** (built-in `node:sqlite`)
- A built client in `../client/dist` (optional for API-only use)

## Start

```bash
cd server
npm install
cp .env.example .env   # optional
npm start
```

The SQLite database is created automatically at `./data/quiz.db`. The `data/` directory is created on first start.

- Host UI: `http://localhost:4000/host`
- Players: `http://<lan-ip>:4000`
- Health check: `GET http://localhost:4000/health`

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Start the server. |
| `npm run dev` | Restart on file changes. |
| `npm test` | Unit + full socket integration tests (temporary SQLite database). |
| `npm run loadtest -- --players 300` | Create a quiz/room and run 300 fake players against a running server. |
| `npm run fake-players -- --players 5` | Smaller end-to-end socket exercise. |

The fake-player script connects its host socket to the `--server` URL. Keep the default `http://localhost:4000` (or another loopback address) because host actions are loopback-only.

```bash
# Complete self-contained run against localhost:4000
node scripts/fake-players.js --players 5 --questions 2 --duration 3

# 300-player load test
node scripts/fake-players.js --players 300 --questions 3 --duration 10

# Join a room that a real host will start
node scripts/fake-players.js --code 123456 --players 300
```

## Configuration

See `.env.example`.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | HTTP + Socket.IO port. |
| `HOST` | `0.0.0.0` | Bind address. Keep `0.0.0.0` so phones on the LAN can connect. |
| `QUIZ_DB_PATH` | `./data/quiz.db` | SQLite file. Parent directories are created automatically. |
| `CLIENT_DIR` | `../client/dist` | Built client served statically when `index.html` exists. |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins, or `*`. |
| `REVEAL_MS` | `5000` | Reveal screen duration before auto-advance. |
| `MAX_PLAYERS_PER_ROOM` | `1000` | Safety cap; spec requires 300+. |
| `ROOM_TTL_MS` | `3600000` | How long a finished room stays in memory. |
| `LOBBY_TTL_MS` | `43200000` | Abandoned lobby cleanup. |

## LAN discovery and static client

`GET /api/server-info` returns:

```json
{ "lanUrl": "http://192.168.1.20:4000", "port": 4000 }
```

`lanUrl` uses the first non-internal IPv4 address from `os.networkInterfaces()` (falling back to `127.0.0.1`). The host lobby uses it for the QR code.

When `../client/dist/index.html` exists, the server serves that directory and falls back to `index.html` for non-`/api` and non-`/socket.io` GET/HEAD routes, so client-side routes such as `/host` work on a hard refresh.

## Access control

There is no signup, login, JWT, or host account.

Host REST routes (`/api/quizzes`, `/api/sessions`, `/api/server-info`) and host Socket.IO events (`host:create_room`, `host:start`, and the other `host:*` controls) are restricted to loopback connections:

- `127.0.0.1`
- `::1`
- `::ffff:127.0.0.1`

Non-loopback REST callers receive `403` with `{ "code": "AUTH_REQUIRED" }`. Non-loopback Socket.IO host events receive an `error` event with code `AUTH_REQUIRED`. Player events are open to the LAN.

Quizzes and sessions are not scoped to a host account; there is one local host.

## REST API

All routes are JSON. Errors use the same shape everywhere:

```json
{ "code": "VALIDATION_ERROR", "message": "A quiz needs at least one question." }
```

### Quizzes

`GET /api/quizzes` returns `{ quizzes: [...] }`, newest updated first.

`POST /api/quizzes` body:

```json
{
  "title": "Capitals",
  "questions": [
    {
      "type": "multiple_choice",
      "text": "Capital of Ghana?",
      "options": ["Accra", "Lagos", "Lome"],
      "correctIndex": 0,
      "durationSec": 15
    },
    {
      "type": "true_false",
      "text": "The sky is blue.",
      "correctIndex": 0
    }
  ]
}
```

Validation:

- `title`: 1-120 characters.
- 1-100 questions.
- `multiple_choice`: 2-4 non-empty options, exactly one `correctIndex`.
- `true_false`: `correctIndex` 0 or 1; server stores options as `["True", "False"]`.
- `durationSec`: integer 1-300, default 20.
- `type` canonical values are `multiple_choice` and `true_false`. Input aliases `mc`, `tf`, etc. are accepted and normalized.

Returns `201 { quiz }`.

`GET /api/quizzes/:id`, `PUT /api/quizzes/:id` (full replace), `DELETE /api/quizzes/:id`.

### Saved results

`GET /api/sessions` returns summaries:

```json
{
  "sessions": [
    {
      "id": "...",
      "quizId": "...",
      "quizTitle": "Capitals",
      "code": "123456",
      "startedAt": "2026-11-27T10:00:00.000Z",
      "endedAt": "2026-11-27T10:05:00.000Z",
      "playerCount": 30
    }
  ]
}
```

`GET /api/sessions/:id` returns the full saved session, including every player's per-question answers.

## Socket.IO

Player sockets do not need a token. Host sockets must connect from the server machine (loopback) to use `host:*` events.

```js
import { io } from 'socket.io-client';

const hostSocket = io('http://localhost:4000');
const playerSocket = io('http://192.168.1.20:4000');
```

### Client to server

| Event | Payload |
| --- | --- |
| `host:create_room` | `{ quizId }` |
| `host:start` | `{ code }` |
| `player:join` | `{ code, nickname }` |
| `player:rejoin` | `{ code, playerToken }` |
| `player:answer` | `{ code, questionIndex, choiceIndex }` |

### Server to client

| Event | Sent to | Payload |
| --- | --- | --- |
| `room:created` | host | `{ code }` |
| `player:joined` | player | `{ playerId, nickname, playerToken }` |
| `lobby:update` | host | `{ playerCount }` |
| `game:question` | everyone in room | `{ index, total, type, text, options[], startsAt, durationMs, myChoiceIndex }` |
| `game:answer_count` | host | `{ index, answered, total }` |
| `question:result` | each player | `{ index, correctIndex, points, totalScore, rank, top5[] }` |
| `game:ended` | player | `{ yourRank, yourScore, top5[] }` |
| `game:ended` | host | `{ leaderboard }` |
| `error` | requesting socket | `{ code, message }` |

`startsAt` is a Unix epoch timestamp in milliseconds. `index` is zero-based.

`myChoiceIndex` is the recipient's latest accepted answer for the current question, or `null` if they have not answered. It is always `null` for the host. On rejoin during a question, this field restores whether the player already answered and which option they chose.

`top5` and `leaderboard` entries have this shape:

```json
{ "playerId": "...", "nickname": "Kwame", "totalScore": 1845, "rank": 1 }
```

Players only ever receive their own result plus the top 5. The host receives the full leaderboard at the end.

`player:joined` is also used to acknowledge a successful `player:rejoin`, with the same `playerId` and `playerToken` and the current nickname.

### Gameplay rules implemented

- Room codes are six digits, including leading zeroes.
- Nicknames are trimmed and capped at 24 characters. Duplicates in a room are case-insensitively suffixed: `Kwame`, `Kwame2`, `Kwame3`.
- The host does not play or score.
- Answers can change until the timer ends. Only the **last server-received answer** counts, at its arrival time.
- `points = round(1000 * timeLeft / durationMs)` for a correct answer; wrong or missing is `0`.
- The server is the only clock. Clients should use `startsAt + durationMs` for the countdown.
- The reveal lasts `REVEAL_MS` (5 seconds by default), then the next question is sent automatically.
- After the last reveal, players get `game:ended`; the host gets the full leaderboard; the session is written to SQLite.
- Late joiners are added to the room immediately, receive the current question for display, but cannot score on it. They become eligible on the next question.
- Active-game player drops retain their record and score. Rejoining with `playerToken` restores the same player and sends the current question state (same `startsAt` and `durationMs`), including their latest answer in `myChoiceIndex`.
- Lobby drops are removed immediately so the host's player count stays accurate.
- Host drops do not stop the game; timers and auto-advance are independent. Results are still saved.
- `game:answer_count.total` counts players eligible to answer the current question (late joiners are excluded until the next question).

## SQLite data model

`./data/quiz.db`:

```sql
quizzes (
  id TEXT PRIMARY KEY,
  title TEXT,
  questions_json TEXT,
  created_at INTEGER,
  updated_at INTEGER
)

sessions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT,
  quiz_title TEXT,
  code TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  players_json TEXT
)
```

Live room state stays in Node memory during a game and is written once at game end.

## Saved session shape

```json
{
  "id": "...",
  "quizId": "...",
  "quizTitle": "Capitals",
  "code": "123456",
  "startedAt": "2026-11-27T10:00:00.000Z",
  "endedAt": "2026-11-27T10:05:00.000Z",
  "players": [
    {
      "playerId": "...",
      "nickname": "Kwame",
      "totalScore": 1845,
      "answers": [
        {
          "questionIndex": 0,
          "choiceIndex": 3,
          "correct": true,
          "points": 850,
          "answeredAt": "2026-11-27T10:00:01.300Z",
          "responseMs": 300
        }
      ]
    }
  ]
}
```

Every question has an entry for every player; missing answers have `choiceIndex: null` and `points: 0`.

## Tests

```bash
npm test
```

The integration suite covers SQLite quiz CRUD, static client/SPA serving, `/api/server-info`, loopback-only host REST and socket events, room creation, join/nickname suffixing, start, answer changes, scoring, answer counts, auto-advance, per-player results, host/full leaderboards, rejoin with score retention and `myChoiceIndex`, late joiners, host disconnects, and saved sessions.
