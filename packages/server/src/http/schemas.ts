/**
 * Fastify JSON schema definitions for HTTP endpoint request validation.
 * These schemas validate incoming HTTP request bodies before business logic runs.
 */

export const createRoomSchema = {
  body: {
    type: 'object',
    required: ['nickname'],
    additionalProperties: false,
    properties: {
      nickname: {
        type: 'string',
        minLength: 2,
        maxLength: 20,
      },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        roomCode: { type: 'string' },
        roomUrl: { type: 'string' },
        playerId: { type: 'string' },
        sessionToken: { type: 'string' },
        reconnectToken: { type: 'string' },
      },
    },
    400: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
  },
} as const;
