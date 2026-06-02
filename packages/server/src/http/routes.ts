/**
 * Fastify HTTP route definitions.
 * Only two HTTP endpoints exist — room creation and health check.
 * All other game actions go through Socket.IO.
 */

import type { FastifyInstance } from 'fastify';
import type { IRoomStore } from '../store/RoomStore.js';
import type { ISessionStore } from '../store/SessionStore.js';
import type { IReconnectStore } from '../store/ReconnectStore.js';
import { RoomManager } from '../services/RoomManager.js';
import type { CreateRoomRequest, CreateRoomResponse, HealthResponse } from '@bunker/shared';

interface RouteDeps {
  roomStore: IRoomStore;
  sessionStore: ISessionStore;
  reconnectStore: IReconnectStore;
}

export async function registerRoutes(
  fastify: FastifyInstance,
  { roomStore, sessionStore, reconnectStore }: RouteDeps,
): Promise<void> {
  const roomManager = new RoomManager(roomStore, sessionStore, reconnectStore);

  fastify.get<{ Reply: HealthResponse }>('/health', async (_req, reply) => {
    const activeRooms = roomStore.getAllRooms().length;
    return reply.send({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      activeRooms,
    });
  });

  // ── Admin: view all active rooms, players, and current host ──────────────────
  // Use this to find room codes and nicknames when editing admin.json.
  fastify.get('/api/admin/rooms', async (_req, reply) => {
    const rooms = roomStore.getAllRooms().map((room) => {
      const host = room.players.get(room.hostPlayerId);
      return {
        roomCode: room.roomCode,
        state: room.state,
        host: host?.nickname ?? '—',
        players: Array.from(room.players.values())
          .filter((p) => p.status !== 'KICKED')
          .map((p) => ({
            nickname: p.nickname,
            status: p.status,
            isHost: p.playerId === room.hostPlayerId,
          })),
      };
    });
    return reply.send({ rooms });
  });

  fastify.post<{
    Body: CreateRoomRequest;
    Reply: CreateRoomResponse | { error: string };
  }>(
    '/api/rooms',
    {
      schema: {
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
      },
      // Custom error handler for schema validation — returns Ukrainian message
      schemaErrorFormatter: () => {
        const err = new Error('Нікнейм повинен містити від 2 до 20 символів') as Error & { statusCode?: number };
        err.statusCode = 400;
        return err;
      },
    },
    async (req, reply) => {
      const { nickname } = req.body;
      const trimmedNickname = nickname.trim();

      // Double-check after trim (the schema checks raw length, we check trimmed)
      if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
        return reply
          .status(400)
          .send({ error: 'Нікнейм повинен містити від 2 до 20 символів' });
      }

      try {
        const result = roomManager.createRoom(trimmedNickname);
        return reply.status(201).send(result);
      } catch (err) {
        fastify.log.error({ err }, 'Failed to create room');
        return reply
          .status(500)
          .send({ error: 'Не вдалося створити кімнату. Спробуйте ще раз.' });
      }
    },
  );
}
