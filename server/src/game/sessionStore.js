import { Session } from '../models/Session.js';

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
        answeredAt: answer?.receivedAt ? new Date(answer.receivedAt) : null,
        responseMs: answer?.responseMs ?? null,
      };
    }),
  }));

  await Session.create({
    hostId: room.hostId,
    quizId: room.quizId,
    code: room.code,
    startedAt: new Date(room.startedAt),
    endedAt: new Date(room.endedAt),
    players,
  });
}
