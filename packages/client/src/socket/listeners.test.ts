/**
 * Verifies the timer:ended listener plays the audio cue and flags the store,
 * so every player (not just the host) gets both the visual and audible signal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EVENTS } from '@bunker/shared';

const { playTimerEndSoundMock } = vi.hoisted(() => ({ playTimerEndSoundMock: vi.fn() }));
vi.mock('../sound/timerEndSound.js', () => ({
  playTimerEndSound: playTimerEndSoundMock,
}));

import { socket } from './socket.js';
import { registerSocketListeners } from './listeners.js';
import { useGameStore } from '../store/gameStore.js';

describe('onTimerEnded', () => {
  beforeEach(() => {
    playTimerEndSoundMock.mockClear();
    useGameStore.getState().reset();
  });

  it('plays the timer-end sound and marks debateTimerEnded when TIMER_ENDED fires', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const onSpy = vi
      .spyOn(socket, 'on')
      .mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
        return socket;
      });
    const offSpy = vi.spyOn(socket, 'off').mockImplementation(() => socket);

    const cleanup = registerSocketListeners();

    expect(handlers[EVENTS.TIMER_ENDED]).toBeDefined();
    handlers[EVENTS.TIMER_ENDED]!();

    expect(playTimerEndSoundMock).toHaveBeenCalledTimes(1);
    expect(useGameStore.getState().debateTimerEnded).toBe(true);

    cleanup();
    onSpy.mockRestore();
    offSpy.mockRestore();
  });
});
