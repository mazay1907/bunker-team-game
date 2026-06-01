/**
 * Unit tests for InMemorySessionStore and InMemoryReconnectStore.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySessionStore } from '../store/SessionStore.js';
import { InMemoryReconnectStore } from '../store/ReconnectStore.js';

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it('sets and gets a session token', () => {
    store.set('token-abc', 'player-1');
    expect(store.get('token-abc')).toBe('player-1');
  });

  it('returns undefined for an unknown token', () => {
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('overwrites an existing token', () => {
    store.set('token-abc', 'player-1');
    store.set('token-abc', 'player-2');
    expect(store.get('token-abc')).toBe('player-2');
  });

  it('deletes a session token', () => {
    store.set('token-abc', 'player-1');
    store.delete('token-abc');
    expect(store.get('token-abc')).toBeUndefined();
  });

  it('does not throw when deleting a non-existent token', () => {
    expect(() => store.delete('does-not-exist')).not.toThrow();
  });
});

describe('InMemoryReconnectStore', () => {
  let store: InMemoryReconnectStore;

  beforeEach(() => {
    store = new InMemoryReconnectStore();
  });

  it('sets and gets a reconnect token', () => {
    store.set('recon-abc', 'player-1');
    expect(store.get('recon-abc')).toBe('player-1');
  });

  it('returns undefined for an unknown token', () => {
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('deletes a reconnect token', () => {
    store.set('recon-abc', 'player-1');
    store.delete('recon-abc');
    expect(store.get('recon-abc')).toBeUndefined();
  });
});
