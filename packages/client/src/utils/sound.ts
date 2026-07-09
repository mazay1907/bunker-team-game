/**
 * Short alert beeps via the Web Audio API — no audio asset files needed.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function beep(ctx: AudioContext, startAt: number, frequency: number, duration: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.3, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}

/** Two-tone descending chime played when the debate timer runs out. */
export function playTimerEndSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  // Browsers suspend a freshly created AudioContext until a user gesture occurs;
  // by the time the timer ends the player has already clicked several buttons.
  void ctx.resume();
  const now = ctx.currentTime;
  beep(ctx, now, 880, 0.18);
  beep(ctx, now + 0.2, 660, 0.28);
}
