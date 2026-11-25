# Quiz Platform Server

Real-time classroom quiz server built with Node.js, Express, Socket.IO, and MongoDB (Mongoose). It owns host auth, saved quizzes, live rooms, timers, scoring, reconnection, and saved results.

The authoritative socket event contract is [CONTRACT.md](CONTRACT.md).

The server listens on **port 4000** by default.

## Requirements

- Node.js 20+
- MongoDB (or use the in-memory development mode)

## Start

```bash
cd server
npm install
cp .env.example .env
# edit MONGO_URI and JWT_SECRET
npm start
```

If you do not have MongoDB installed, start a disposable in-memory MongoDB (development only):

```bash
npm run dev:memory
```

Health check: `GET http://localhost:4000/health`

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Start against `MONGO_URI`. |
| `npm run dev` | Restart on file changes. |
| `npm run dev:memory` | Start with a local in-memory MongoDB. Development only. |
| `npm run fake-players -- --players 5` | Sign up a host, create a quiz and room, connect fake players, start, answer, print results. |
| `npm run fake-players -- --players 300` | Load test with 300 players. |
| `npm test` | Unit + full socket integration tests (uses in-memory MongoDB). |

Fake-player examples:

```bash
# Complete self-contained run
node scripts/fake-players.js --players 5 --questions 2 --duration 3

# Load test against a server with fast settings
REVEAL_MS=1000 node scripts/fake-players.js --players 300 --questions 3 --duration 10

# Join a room that a real host will start
node scripts/fake-players.js --code 123456 --players 300
```

The fake-player script exits non-zero if any player misses results, misses the final payload, receives an error, or the game times out.

## Configuration

See `.env.example`.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | HTTP + Socket.IO port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/quiz_platform` | MongoDB connection string. |
| `JWT_SECRET` | insecure dev value | **Set a long random value in production.** |
| `JWT_EXPIRES_IN` | `7d` | Host token lifetime. |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins, or `*`. |
| `REVEAL_MS` | `5000` | Reveal screen duration before auto-advance. |
| `MAX_PLAYERS_PER_ROOM` | `1000` | Safety cap; spec requires 300+. |
| `ROOM_TTL_MS` | `3600000` | How long a finished room stays in memory. |
| `LOBBY_TTL_MS` | `43200000` | Abandoned lobby cleanup. |

## REST API

All routes are JSON. Protected routes require `Authorization: Bearer <token>`.

Errors use the same shape everywhere:

```json
{ "code": "VALIDATION_ERROR", "message": "A quiz needs at least one question." }
```

### Auth

`POST /api/auth/signup`

```json
{ "email": "host@example.com", "password": "secret12" }
```

Returns `201`:

```json
{
  "token": "<jwt>",
  "host": { "id": "...", "email": "host@example.com", "createdAt": "..." }
}
```

`POST /api/auth/login` with the same body returns `{ token, host }`.

`GET /api/auth/me` returns `{ host }`.

### Quizzes

`GET /api/quizzes` returns `{ quizzes: [...] }` for the logged-in host, newest updated first.

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

Quizzes are scoped to the owning host.

### Saved results

`GET /api/sessions` returns summaries:

```json
{
  "sessions": [
    { "id": "...", "quizId": "...", "code": "123456", "startedAt": "...", "endedAt": "...", "playerCount": 30 }
  ]
}
```

`GET /api/sessions/:id` returns the full saved session, including every player's per-question answers.

## Socket.IO

Host sockets must connect with the JWT from auth. Player sockets do not need a token.

```js
import { io } from 'socket.io-client';

const hostSocket = io('http://localhost:4000', {
  auth: { token: hostJwt },
});

const playerSocket = io('http://localhost:4000');
```

The token is read from `handshake.auth.token` (a `Bearer ` prefix is tolerated) or `handshake.query.token`.

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
- After the last reveal, players get `game:ended`; the host gets the full leaderboard; the session is written to MongoDB.
- Late joiners are added to the room immediately, receive the current question for display, but cannot score on it. They become eligible on the next question.
- Active-game player drops retain their record and score. Rejoining with `playerToken` restores the same player and sends the current question state (same `startsAt` and `durationMs`), including their latest answer in `myChoiceIndex`.
- Lobby drops are removed immediately so the host's player count stays accurate.
- Host drops do not stop the game; timers and auto-advance are independent. Results are still saved.
- `game:answer_count.total` counts players eligible to answer the current question (late joiners are excluded until the next question).

## Saved session shape

```json
{
  "id": "...",
  "hostId": "...",
  "quizId": "...",
  "code": "123456",
  "startedAt": "...",
  "endedAt": "...",
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
          "answeredAt": "...",
          "responseMs": 300
        }
      ]
    }
  ]
}
```

Every question has an entry for every player; missing answers have `choiceIndex: null` and `points: 0`.

## Contract decisions (locked)

The final decisions are documented in [CONTRACT.md](CONTRACT.md):

1. `game:question` includes `myChoiceIndex` so reconnecting players can restore whether they already answered.
2. Player `game:ended` is `{ yourRank, yourScore, top5 }`; host `game:ended` is `{ leaderboard }`.
3. `top5` and `leaderboard` entries are `{ playerId, nickname, totalScore, rank }`; question types are `multiple_choice` and `true_false`.
4. Host authentication is via the Socket.IO handshake, since the event payloads do not carry tokens.
5. There is no host rejoin event. Host disconnects do not stop the game, auto-advance, or result saving.

## Tests

```bash
npm test
```

The integration suite covers REST auth/quiz CRUD, room creation, join/nickname suffixing, start, answer changes, scoring, answer counts, auto-advance, per-player results, host/full leaderboards, rejoin with score retention and `myChoiceIndex`, late joiners, host disconnects, saved sessions, and socket auth/ownership errors.
