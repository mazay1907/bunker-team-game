/**
 * Tests for GET /health endpoint.
 * Verifies the endpoint returns the required shape for Docker health checks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { InMemoryRoomStore } from '../store/RoomStore.js';
import { InMemorySessionStore } from '../store/SessionStore.js';
import { InMemoryReconnectStore } from '../store/ReconnectStore.js';
import { registerRoutes } from '../http/routes.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  const roomStore = new InMemoryRoomStore();
  const sessionStore = new InMemorySessionStore();
  const reconnectStore = new InMemoryReconnectStore();
  await registerRoutes(app, { roomStore, sessionStore, reconnectStore });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('returns status: ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.status).toBe('ok');
  });

  it('returns uptime as a non-negative number', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime as number).toBeGreaterThanOrEqual(0);
  });

  it('returns activeRooms as a number starting at 0', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(typeof body.activeRooms).toBe('number');
    expect(body.activeRooms).toBe(0);
  });

  it('reflects room count accurately after rooms are created', async () => {
    // Create a room via HTTP endpoint
    await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { nickname: 'TestPlayer' },
    });

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.activeRooms).toBe(1);
  });
});
