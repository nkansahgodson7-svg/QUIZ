export const CLIENT_EVENTS = Object.freeze({
  HOST_CREATE_ROOM: 'host:create_room',
  HOST_START: 'host:start',
  PLAYER_JOIN: 'player:join',
  PLAYER_REJOIN: 'player:rejoin',
  PLAYER_ANSWER: 'player:answer',
});

export const SERVER_EVENTS = Object.freeze({
  ROOM_CREATED: 'room:created',
  PLAYER_JOINED: 'player:joined',
  LOBBY_UPDATE: 'lobby:update',
  GAME_QUESTION: 'game:question',
  GAME_ANSWER_COUNT: 'game:answer_count',
  QUESTION_RESULT: 'question:result',
  GAME_ENDED: 'game:ended',
  ERROR: 'error',
});
