# Quiz Platform Spec (v1)

A real-time classroom quiz platform in the style of quiz.com. A host creates a quiz, opens a room, and shares a code. Students join on their phones, everyone answers each question against a shared timer, faster correct answers score more, and a leaderboard shows at the end.

**Stack:** MERN + Socket.IO (React, Express, MongoDB, Node).

## 1. Roles

**Host**

- Signs up and logs in with email and password.
- Builds and saves quizzes, and reuses them.
- Opens a room from a saved quiz, shares the join code, and starts the game.
- Only controls the game. The host does not play and does not score.
- Views saved results of past games later.

**Player**

- No account. Joins with the room code and a nickname.
- If the nickname is already taken in that room, a number is added automatically (Kwame, Kwame2).
- Up to 300+ players per room.

## 2. Quiz content

- Question types: multiple choice (2 to 4 options, exactly one correct) and true/false.
- Each question has a time limit. The default is 20 seconds and the host can override it per question.
- Quizzes are built and saved before a session, then picked when opening a room.

## 3. Game flow

1. **Lobby.** The host opens a room and gets a code. Players join with the code and a nickname. The host sees the player count.
2. **Start.** The host presses start. The first question is sent to everyone.
3. **Question.** Every phone shows the full question and options at the same time. One server-controlled timer runs for everyone.
4. **Answering.** A player can change their answer until time runs out. Their score uses the time of their last tap.
5. **Reveal.** When time runs out, each player sees the correct answer, the points they earned, and the top 5 for a few seconds.
6. **Auto-advance.** The game moves to the next question by itself. No host click is needed.
7. **End.** The final leaderboard is shown and the results are saved for the host.

Late joiners can enter after the game has started. They begin scoring from the next question on.

## 4. Timing and scoring

- The server is the only clock. It records when it sends each question (`startsAt`) and when each answer arrives. Client clocks are never trusted.
- Clients show a countdown using the server's start time and duration, so everyone's display matches closely.
- Wrong or missing answer: 0 points.
- Correct answer: `points = round(1000 * timeLeft / duration)`, where `timeLeft` is measured at the server arrival time of the player's last answer.
- The player's countdown keeps running until the question ends, because answers can be changed. It does not pause on tap.

## 5. Resilience

- **Player drops:** they can rejoin with the same nickname and keep their score. On join the server gives the client a `playerToken`, stored in the browser, which is used to rejoin.
- **Host drops:** the game keeps running, because auto-advance does not depend on the host.
- Reconnecting players get the current question state (question, time remaining, whether they already answered).

## 6. Scale (300+ players)

- Send each player only what they need: their own result plus the top 5, never the full leaderboard to everyone.
- Keep payloads small (many players will be on mobile data).
- Keep per-room state in memory on the Node server during a game and write to MongoDB at the end, not on every answer.
- Write a load-test script that connects 300+ fake socket clients to a room before trusting this.

## 7. Data model (MongoDB)

- **hosts**: email, passwordHash, createdAt.
- **quizzes**: hostId, title, questions\[\] (type, text, options\[\], correctIndex, durationSec).
- **sessions** (saved results): hostId, quizId, code, startedAt, endedAt, players\[\] (nickname, totalScore, per-question answers and points).

Live room state (players, current question, timers, answers) lives in server memory while the game runs.

## 8. Socket event contract

This is the agreement all three parts must build against. Change it in one place only.

**Client to server**

- `host:create_room` `{ quizId }`
- `host:start` `{ code }`
- `player:join` `{ code, nickname }`
- `player:rejoin` `{ code, playerToken }`
- `player:answer` `{ code, questionIndex, choiceIndex }`

**Server to client**

- `room:created` `{ code }`
- `player:joined` `{ playerId, nickname, playerToken }`
- `lobby:update` `{ playerCount }`
- `game:question` `{ index, total, type, text, options[], startsAt, durationMs }`
- `game:answer_count` `{ index, answered, total }` (host only)
- `question:result` `{ index, correctIndex, points, totalScore, rank, top5[] }` (per player)
- `game:ended` `{ yourRank, yourScore, top5[] }` (players) and the full leaderboard (host)
- `error` `{ code, message }`

## 9. Assumed defaults (not yet confirmed)

- The host screen shows the question and a live count of who has answered.
- Room codes are 6 digits.
- Players see the top 5 plus their own rank at the end. The host sees the full leaderboard.
- The reveal screen lasts about 5 seconds.

## 10. Work split for parallel agents

Each agent works in its own git worktree and branch, and only touches its own folder. The socket event contract above is the only shared surface.

1. **Game server** (`/server`): Socket.IO room manager, timers, scoring, reconnection, and saving results. Includes the load-test script.
2. **Host app** (`/client-host`): signup and login, quiz builder, saved quizzes, lobby, in-game host view, saved results view. Includes the REST routes for auth and quizzes (or the server agent owns these, decided up front).
3. **Player app** (`/client-player`): join screen, question screen with timer, answer changing, reveal screen, final screen, rejoin handling. Phone-first.

**Suggested build order:** lock the event contract, then build the server with a tiny fake client, then the player screen, then the host app, then integrate and load-test.
