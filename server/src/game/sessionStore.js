import { createSession } from '../db.js';

export async function saveGameSession(room) {
  const players = Array.from(room.players.values()).map((player) => ({
    playerId: player.id,
    nickname: player.nickname,
    totalScore: player.totalScore,
    answers: room.quiz.questions.map((_question, index) => {
      const answer = player.answers.get(index);
      return {
        questionIndex: index,
        choiceIndex: answer?.choiceIndex ?? null,
        correct: answer?.correct ?? false,
        points: answer?.points ?? 0,
        answeredAt: answer?.receivedAt ? new Date(answer.receivedAt).toISOString() : null,
        responseMs: answer?.responseMs ?? null,
      };
    }),
  }));

  createSession({
    quizId: room.quizId,
    quizTitle: room.quiz.title,
    code: room.code,
    startedAt: room.startedAt,
    endedAt: room.endedAt,
    players,
  });
}
