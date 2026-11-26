# Quiz Platform Socket Contract (Final v1)

This is the authoritative Socket.IO contract for the quiz platform. Event names and payloads are final. Do not add, remove, or rename fields without changing this document first.

No events other than the ones listed here are emitted or accepted.

## Common conventions

- `code`: string matching `^\d{6}$` (six digits, leading zeroes allowed).
- `index` and `questionIndex`: zero-based question index.
- `choiceIndex` and `myChoiceIndex`: zero-based option index.
- `startsAt`: server Unix epoch time in milliseconds when the question was sent.
- `durationMs`: question duration in milliseconds.
- `total`: total number of questions in the quiz.
- `playerId`: server-generated string.
- `playerToken`: opaque server-generated string used only for `player:rejoin`.
- `myChoiceIndex` is a `number` when the player has an accepted answer for the current question, otherwise `null`.
- `top5` and `leaderboard` entries are always exactly:

```json
{
  "playerId": "string",
  "nickname": "string",
  "totalScore": 1234,
  "rank": 1
}
```

- Question `type` is exactly `"multiple_choice"` or `"true_false"`.

## Authentication

`host:create_room`, `host:start`, `host:end_question`, and `host:end_game` require host authentication. The REST auth token from `POST /api/auth/signup` or `POST /api/auth/login` is supplied on the Socket.IO handshake, not in the event payload:

```js
const hostSocket = io('http://localhost:4000', {
  auth: { token: hostJwt },
});
```

The server accepts `handshake.auth.token` or `handshake.query.token`. A leading `Bearer ` is tolerated. Player sockets do not need a token.

There is no host rejoin event. If the host disconnects, the game keeps running and the result is still saved.

## Client to server

### `host:create_room`

```json
{ "quizId": "string" }
```

Requires host auth. Loads a saved quiz owned by the authenticated host and creates a room.

### `host:start`

```json
{ "code": "123456" }
```

Requires host auth and ownership of the room. Only valid while the room is in the lobby.

### `host:end_question`

```json
{ "code": "123456" }
```

Requires host auth and ownership of the room. Immediately ends the active question timer and locks answers. The question is scored and `question:result` / `host:standings` are emitted exactly as if the timer had expired. Only valid while a question is open.

### `host:end_game`

```json
{ "code": "123456" }
```

Requires host auth and ownership of the room. Ends the match early, skips any remaining questions, emits `game:ended` to the host and connected players, and saves the session. If a question is still open when the host ends the game, it is not scored.

### `player:join`

```json
{ "code": "123456", "nickname": "Kwame" }
```

Nickname is trimmed and limited to 24 characters. If already taken in that room (case-insensitive), the server appends a number: `Kwame`, `Kwame2`, `Kwame3`.

### `player:rejoin`

```json
{ "code": "123456", "playerToken": "opaque-token" }
```

Restores the same `playerId`, nickname, answers, and score. Token is returned by `player:joined`.

### `player:answer`

```json
{ "code": "123456", "questionIndex": 0, "choiceIndex": 2 }
```

Both indices are integers. The player may send more than one answer for the same question. Only the last answer received before the question closes counts. The server does not acknowledge a successful answer directly; the host receives `game:answer_count`.

## Server to client

### `room:created`

Sent to the host that created the room.

```json
{ "code": "123456" }
```

### `player:joined`

Sent to the joining or rejoining player.

```json
{
  "playerId": "string",
  "nickname": "Kwame",
  "playerToken": "opaque-token"
}
```

On rejoin, `playerId` and `playerToken` are the same as before. `nickname` is the player's current in-room nickname (which may have a numeric suffix).

### `lobby:update`

Host only. Sent when the room is created and whenever the lobby player count changes.

```json
{ "playerCount": 12 }
```

`playerCount` counts players currently in the lobby. A player who disconnects in the lobby is removed and the count is updated.

### `game:question`

Sent to every connected host and player. The host's copy includes `correctIndex`; player copies never do. On join or rejoin during an active question, the server sends it immediately to that player only.

```json
{
  "index": 0,
  "total": 5,
  "type": "multiple_choice",
  "text": "Capital of Ghana?",
  "options": ["Accra", "Lagos", "Lome"],
  "startsAt": 1795614318002,
  "durationMs": 20000,
  "myChoiceIndex": 2,
  "correctIndex": 2
}
```

Every field is required, except `correctIndex`, which is present only in the host's copy.

- `correctIndex` is the zero-based correct option index. It is sent only to the host while the question is open. Players learn the answer from `question:result` after the question closes.
- `myChoiceIndex` is always `null` for the host.
- For a player, `myChoiceIndex` is their latest server-received answer for this question, or `null` if they have not answered.
- On join/rejoin during a question, `startsAt` and `durationMs` are the original values, so the client can compute the remaining time.
- A late joiner receives the current question with `myChoiceIndex: null` but is not eligible to score until the next question.
- The server does not send another `game:question` when a player changes an answer; the client already knows its local selection. A rejoin restores the latest answer through `myChoiceIndex`.

Question deadline: `startsAt + durationMs`. Answers arriving at or after the deadline are ignored.

### `game:answer_count`

Host only. This is the live state of the current question. Sent when a question starts, after every accepted or changed answer, and when a player joins, rejoins, or disconnects during a question.

```json
{
  "index": 0,
  "answered": 27,
  "total": 30,
  "choiceCounts": [7, 12, 8, 0],
  "players": [
    {
      "playerId": "string",
      "nickname": "Ama",
      "answered": true,
      "choiceIndex": 2,
      "connected": true
    }
  ]
}
```

- `answered` is the number of players with an accepted answer for the current question. Re-answering updates the same player's answer and does not increase `answered` twice.
- `total` is the number of players eligible to answer the current question. Late joiners are excluded from `total` until the next question.
- `choiceCounts` has one entry per option, in option order (A/B/C/D for a four-option question). It counts the latest accepted answer for each player. Changing an answer moves the count from the old option to the new one.
- `players` contains every player currently in the room, in join order. `answered` is `true` when the player has an accepted answer, `choiceIndex` is their latest answer or `null`, and `connected` becomes `false` if their socket drops.

Players never receive this event.

### `question:result`

Sent to each player at the start of the reveal, when the question closes at its deadline or via `host:end_question`.

```json
{
  "index": 0,
  "correctIndex": 2,
  "points": 850,
  "totalScore": 1730,
  "rank": 3,
  "top5": [
    { "playerId": "string", "nickname": "Ama", "totalScore": 1900, "rank": 1 }
  ]
}
```

- `points` is the points earned on this question by this player.
- `totalScore` and `rank` are after this question's points have been applied.
- `top5` is the current top five after this question, length 0-5.
- If a player rejoins during the reveal of the current question, the server re-sends their last `question:result`.

### `host:standings`

Host only. Sent after every question closes, at the same time `question:result` is sent to players. The host also receives it when `host:end_question` closes a question early.

```json
{
  "index": 0,
  "leaderboard": [
    { "playerId": "string", "nickname": "Ama", "totalScore": 1900, "rank": 1 }
  ]
}
```

`leaderboard` contains every player, ordered by `rank`, after this question's points have been applied. Players never receive this event.

### `game:ended`

Sent to each connected player after the final reveal, or immediately when the host ends the game early.

```json
{
  "yourRank": 3,
  "yourScore": 1845,
  "top5": [
    { "playerId": "string", "nickname": "Ama", "totalScore": 1900, "rank": 1 }
  ]
}
```

Sent to the connected host after the final reveal, or immediately when the host ends the game early.

```json
{
  "leaderboard": [
    { "playerId": "string", "nickname": "Ama", "totalScore": 1900, "rank": 1 }
  ]
}
```

`leaderboard` contains every player, ordered by `rank`. Hosts never receive `yourRank` or `yourScore`. Players never receive the full leaderboard.

The result is saved to MongoDB at game end whether or not the host is connected.

### `error`

Sent only to the socket that caused the error.

```json
{ "code": "ROOM_NOT_FOUND", "message": "Room not found. Check the code." }
```

Error codes:

| Code | Meaning |
| --- | --- |
| `AUTH_REQUIRED` | Host event without a valid host token on the handshake. |
| `QUIZ_NOT_FOUND` | Quiz does not exist or is not owned by the authenticated host. |
| `QUIZ_EMPTY` | Quiz has no questions. |
| `ROOM_NOT_FOUND` | No room with that six-digit code. |
| `NOT_HOST` | Authenticated host does not own that room. |
| `ALREADY_STARTED` | `host:start` after the game has started. |
| `GAME_ENDED` | Room/game has already ended. |
| `GAME_NOT_STARTED` | `host:end_game` before the game has started. |
| `QUESTION_NOT_ACTIVE` | `host:end_question` when no question is accepting answers. |
| `INVALID_NICKNAME` | Nickname is empty or longer than 24 characters. |
| `ROOM_FULL` | Room player cap reached. |
| `ALREADY_JOINED` | This socket already joined that room as a player. |
| `INVALID_PLAYER_TOKEN` | Rejoin token is unknown or no longer valid. |
| `NOT_IN_ROOM` | Answer from a socket that has not joined the room. |
| `INVALID_ANSWER` | `questionIndex` or `choiceIndex` is not an integer. |
| `INVALID_CHOICE` | `choiceIndex` is outside the current question's options. |
| `NOT_ELIGIBLE` | A late joiner tried to answer the question they joined during. |
| `INTERNAL_ERROR` | Unexpected server error. |

## Event order

1. Host connects with a token, emits `host:create_room`, receives `room:created`, then `lobby:update`.
2. Players emit `player:join`; each receives `player:joined`; the host receives `lobby:update`.
3. Host emits `host:start`. Everyone receives `game:question` (the host copy includes `correctIndex`); host receives `game:answer_count` with `answered: 0`, `choiceCounts`, and `players`.
4. Players emit `player:answer` as often as they like before the deadline. Host receives updated `game:answer_count` after each answer change and when players join, rejoin, or disconnect.
5. At `startsAt + durationMs`, or when the host emits `host:end_question`, the question closes. Each connected player receives `question:result` and the host receives `host:standings`.
6. After the reveal delay (5000 ms by default), the next `game:question` is sent automatically. No host action is required.
7. After the final reveal, or when the host emits `host:end_game`, players receive `game:ended` with their rank/score/top 5, the host receives `game:ended` with the full leaderboard, and the session is saved.

## Scoring and timing (final)

- The server is the only clock.
- An answer is accepted only if the server receives it at `receivedAt < startsAt + durationMs` and the question has not already been closed.
- The player's latest accepted answer is used.
- `timeLeft = (startsAt + durationMs) - receivedAt`.
- Correct answer: `points = round(1000 * timeLeft / durationMs)`.
- Wrong or missing answer: `0` points.
- A player's countdown does not pause when they answer; they may change their answer until the deadline.
- `host:end_question` closes early without changing the scoring formula; answers already accepted are scored normally.
- The reveal lasts about 5 seconds, then auto-advance.

## Accepted decisions

These decisions are final:

1. `myChoiceIndex` is added to `game:question` to restore a reconnecting player's answered state.
2. Player `game:ended` is exactly `{ yourRank, yourScore, top5 }`. Host `game:ended` is exactly `{ leaderboard }`.
3. `top5` and `leaderboard` entries use `{ playerId, nickname, totalScore, rank }`.
4. Host auth is supplied on the Socket.IO handshake; event payloads do not carry tokens.
5. There is no host rejoin event. Host disconnects do not stop timers, auto-advance, or result saving.
6. `correctIndex` on `game:question`, the full `game:answer_count` live state, and `host:standings` are host-only. Players never receive them before the matching `question:result`.
7. `host:end_question` and `host:end_game` are host-authenticated room-owner controls. Auto-advance remains the default between questions.
