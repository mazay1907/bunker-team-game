/**
 * BUGFIX_SESSION_ROOM_SCOPING — client-side cookie scoping unit tests.
 *
 * Verifies:
 * - sessionKey()/reconnectKey() build room-scoped cookie names.
 * - setActiveRoomCode() + the socket `auth` callback resolve tokens scoped to
 *   whichever room was last set as active (call site #1 in the spec).
 * - A cookie set for room X is not returned when reading room Y's scoped key
 *   (Scenario C2/D — old-room data preserved but never leaked into a new room).
 *
 * The vitest config for this package runs tests in a plain Node environment
 * (no jsdom), so `document.cookie` is polyfilled below with a minimal in-memory
 * jar before importing socket.ts (which reads/writes it lazily, not at import
 * time, so this polyfill only needs to exist before the functions are called).
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── Minimal document.cookie polyfill (Node has no DOM) ──────────────────────
let cookieJar: Record<string, string> = {};

function installCookiePolyfill(): void {
  cookieJar = {};
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get cookie(): string {
        return Object.entries(cookieJar)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
      },
      set cookie(value: string) {
        // Mimic browser behavior: `name=value; expires=...; path=/; SameSite=Strict`
        const [pair] = value.split(';');
        const eq = pair!.indexOf('=');
        const name = pair!.slice(0, eq);
        const val = pair!.slice(eq + 1);
        cookieJar[name] = val;
      },
    },
  });
}

installCookiePolyfill();

const {
  getCookie,
  setCookie,
  sessionKey,
  reconnectKey,
  setActiveRoomCode,
  getActiveRoomCode,
} = await import('./socket.js');

describe('room-scoped cookie keys', () => {
  beforeEach(() => {
    installCookiePolyfill();
    setActiveRoomCode(null);
  });

  it('sessionKey/reconnectKey build distinct names per room code', () => {
    expect(sessionKey('Y9E3XX')).toBe('bunker_session_Y9E3XX');
    expect(reconnectKey('Y9E3XX')).toBe('bunker_reconnect_Y9E3XX');
    expect(sessionKey('ZZP7J6')).not.toBe(sessionKey('Y9E3XX'));
  });

  it('normalizes lowercase room codes to uppercase for the cookie key', () => {
    expect(sessionKey('y9e3xx')).toBe('bunker_session_Y9E3XX');
  });

  it('a cookie set for room X is not visible under room Y\'s scoped key', () => {
    setCookie(reconnectKey('Y9E3XX'), 'token-for-x');
    expect(getCookie(reconnectKey('ZZP7J6'))).toBeNull();
    // Old room's data is preserved, not deleted (Scenario D)
    expect(getCookie(reconnectKey('Y9E3XX'))).toBe('token-for-x');
  });

  it('setActiveRoomCode records the room the auth callback should scope to', () => {
    expect(getActiveRoomCode()).toBeNull();
    setActiveRoomCode('zzp7j6');
    expect(getActiveRoomCode()).toBe('ZZP7J6');
    setActiveRoomCode(null);
    expect(getActiveRoomCode()).toBeNull();
  });

  it('socket auth callback resolves tokens scoped to the active room only', async () => {
    const { socket } = await import('./socket.js');

    setCookie(sessionKey('Y9E3XX'), 'session-x');
    setCookie(reconnectKey('Y9E3XX'), 'reconnect-x');
    setCookie(sessionKey('ZZP7J6'), 'session-y');
    setCookie(reconnectKey('ZZP7J6'), 'reconnect-y');

    setActiveRoomCode('ZZP7J6');
    const authFn = socket.auth as (cb: (data: Record<string, string | null>) => void) => void;
    const result = await new Promise<Record<string, string | null>>((resolve) => authFn(resolve));
    expect(result).toEqual({ sessionToken: 'session-y', reconnectToken: 'reconnect-y' });

    setActiveRoomCode('Y9E3XX');
    const result2 = await new Promise<Record<string, string | null>>((resolve) => authFn(resolve));
    expect(result2).toEqual({ sessionToken: 'session-x', reconnectToken: 'reconnect-x' });
  });

  it('socket auth callback returns nulls when no room is active', async () => {
    const { socket } = await import('./socket.js');
    setCookie(sessionKey('Y9E3XX'), 'session-x');

    setActiveRoomCode(null);
    const authFn = socket.auth as (cb: (data: Record<string, string | null>) => void) => void;
    const result = await new Promise<Record<string, string | null>>((resolve) => authFn(resolve));
    expect(result).toEqual({ sessionToken: null, reconnectToken: null });
  });
});
