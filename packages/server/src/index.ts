/**
 * Server entry point.
 * Wires together Fastify, Socket.IO, stores, and services.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { EVENTS } from '@bunker/shared';
import { InMemoryRoomStore } from './store/RoomStore.js';
import { InMemorySessionStore } from './store/SessionStore.js';
import { InMemoryReconnectStore } from './store/ReconnectStore.js';
import { RoomManager } from './services/RoomManager.js';
import { registerRoutes } from './http/routes.js';
import { createSocketMiddleware } from './socket/middleware.js';
import { registerRoomHandlers } from './socket/handlers/roomHandlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const ALLOWED_ORIGIN = process.env['ALLOWED_ORIGIN'] ?? `http://localhost:${PORT}`;

async function start(): Promise<void> {
  const fastify = Fastify({
    logger: {
      level: NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // ── Stores (no singletons — injected via constructor) ─────────────────────────
  const roomStore = new InMemoryRoomStore();
  const sessionStore = new InMemorySessionStore();
  const reconnectStore = new InMemoryReconnectStore();
  const roomManager = new RoomManager(roomStore, sessionStore, reconnectStore);

  // ── CORS ───────────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
  });

  // ── Rate limiting (room creation only) ────────────────────────────────────────
  await fastify.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    // Only apply to POST /api/rooms — done via route-level config
    skipOnError: false,
  });

  // ── Static file serving (React dist/) ─────────────────────────────────────────
  const clientDistPath = resolve(__dirname, '../../client/dist');
  if (existsSync(clientDistPath)) {
    await fastify.register(staticPlugin, {
      root: clientDistPath,
      prefix: '/',
      // Serve index.html for all non-API routes (SPA fallback)
      setHeaders: (res) => {
        // Content-Security-Policy for XSS mitigation
        res.setHeader(
          'Content-Security-Policy',
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:${PORT} wss://localhost:${PORT}`,
        );
      },
    });

    // SPA fallback — serve index.html for /r/:code routes
    fastify.setNotFoundHandler((_req, reply) => {
      void reply.sendFile('index.html');
    });
  }

  // ── HTTP routes ────────────────────────────────────────────────────────────────
  await registerRoutes(fastify, { roomStore, sessionStore, reconnectStore });

  // ── Socket.IO ──────────────────────────────────────────────────────────────────
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: ALLOWED_ORIGIN,
      methods: ['GET', 'POST'],
    },
    // Needed for dev: Vite proxies /socket.io to port 3000
    path: '/socket.io',
  });

  // Socket middleware — validates tokens, attaches playerId to socket.data
  io.use(createSocketMiddleware(sessionStore));

  // Socket event rate limiting (30 events/second per socket)
  io.use((socket, next) => {
    let eventCount = 0;
    const WINDOW_MS = 1000;
    const MAX_EVENTS = 30;

    let windowStart = Date.now();

    socket.onAny(() => {
      const now = Date.now();
      if (now - windowStart > WINDOW_MS) {
        eventCount = 0;
        windowStart = now;
      }
      eventCount++;
      if (eventCount > MAX_EVENTS) {
        socket.disconnect(true);
      }
    });

    next();
  });

  io.on('connection', (socket) => {
    console.log(`[connect] ${socket.id}`);

    // Register all event handlers for this socket
    registerRoomHandlers(socket, {
      io,
      roomStore,
      sessionStore,
      reconnectStore,
      roomManager,
    });

    socket.on('disconnect', (reason) => {
      console.log(`[disconnect] ${socket.id} reason=${reason}`);
    });
  });

  // ── Start server ───────────────────────────────────────────────────────────────
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server listening on port ${PORT} (${NODE_ENV})`);
}

start().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
