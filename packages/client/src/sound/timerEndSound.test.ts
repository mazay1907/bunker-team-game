/**
 * The Web Audio API isn't available in the Vitest (node) environment, so this
 * mainly guards the "fail silently, never throw" contract that keeps a
 * missing sound cue from ever breaking the game flow.
 */
import { describe, it, expect } from 'vitest';
import { playTimerEndSound } from './timerEndSound.js';

describe('playTimerEndSound', () => {
  it('does not throw when the Web Audio API / window is unavailable', () => {
    expect(() => playTimerEndSound()).not.toThrow();
  });
});
