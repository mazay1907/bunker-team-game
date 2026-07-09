/**
 * Debate-timer-ended sound cue.
 *
 * Generated on the fly via the Web Audio API instead of shipping a binary
 * asset — keeps the bundle small and avoids introducing an audio pipeline
 * for a single short chime.
 *
 * Browsers block audio until the user has interacted with the page; since
 * players already click/type through Home + Lobby before reaching the
 * debate phase, this normally plays without issue. If it's blocked anyway
 * (or the API isn't available, e.g. during SSR/tests), we fail silently —
 * a missing sound cue must never break the game flow.
 */

type WindowWithWebkitAudio = typeof window & { webkitAudioContext?: typeof AudioContext };

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextClass();
  }
  return sharedAudioContext;
}

/** Schedules a single short sine-wave tone starting `offsetSeconds` from now. */
function scheduleTone(ctx: AudioContext, frequencyHz: number, offsetSeconds: number): void {
  const startTime = ctx.currentTime + offsetSeconds;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = frequencyHz;

  // Quick fade in/out avoids an audible click at tone start/end.
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.2, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.25);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + 0.3);
}

/** Plays a short two-tone chime to signal the debate timer has ended. */
export function playTimerEndSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const playChime = (): void => {
      scheduleTone(ctx, 880, 0);
      scheduleTone(ctx, 1108.73, 0.15);
    };

    if (ctx.state === 'suspended') {
      // Autoplay-blocked contexts start suspended — resume() requires a
      // prior user gesture. If the browser refuses, fail silently.
      ctx.resume().then(playChime).catch(() => undefined);
    } else {
      playChime();
    }
  } catch {
    // Any Web Audio failure must never break the game flow.
  }
}
