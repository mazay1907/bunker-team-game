/**
 * DebateTimer — countdown display with host controls and speaking order.
 *
 * States:
 * - No timer: host sees "Start timer" button; others wait
 * - Running (>30s): white countdown
 * - Urgent (≤30s): danger red
 * - Critical (≤10s): blinking danger red
 * - Ended (remaining=0 or timerEnded=true): "Час вийшов!" signal
 *
 * Speaking order shows all players in circular turn order.
 * Host can advance to next speaker.
 */

import { t } from '../../i18n/t.js';

interface Speaker {
  playerId: string;
  nickname: string;
}

interface DebateTimerProps {
  remaining: number | null;
  timerEnded: boolean;
  isHost: boolean;
  isCurrentSpeaker: boolean;
  speakingOrder: Speaker[];
  currentSpeakerIndex: number;
  onStartTimer: () => void;
  onExtend: () => void;
  onForceVote: () => void;
  onNextSpeaker: () => void;
}

function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function DebateTimer({
  remaining,
  timerEnded,
  isHost,
  isCurrentSpeaker,
  speakingOrder,
  currentSpeakerIndex,
  onStartTimer,
  onExtend,
  onForceVote,
  onNextSpeaker,
}: DebateTimerProps): JSX.Element {
  const timerRunning = remaining !== null && remaining > 0;
  const isUrgent = timerRunning && remaining <= 30;
  const isCritical = timerRunning && remaining <= 10;
  // timerEnded is set by the explicit TIMER_ENDED server event (not just reaching 0,
  // because between speakers the counter hits 0 briefly before restarting for the next speaker)
  const showTimerEnded = timerEnded;

  return (
    <div className="bg-bunker-surface border border-bunker-border rounded p-4 flex flex-col gap-3">
      {/* Timer row */}
      <div className="flex items-center justify-between">
        <h3 className="font-oswald font-bold text-sm text-bunker-muted uppercase tracking-wider">
          {t('game.debate.title')}
        </h3>

        {showTimerEnded ? (
          <span className="font-oswald font-bold text-lg text-bunker-danger animate-pulse">
            {t('game.debate.timerEnded')}
          </span>
        ) : timerRunning ? (
          <div className="flex items-center gap-1.5">
            <span className="font-inter text-xs text-bunker-muted">{t('game.debate.timeLeft')}:</span>
            <span
              className={[
                'font-mono font-bold text-2xl tabular-nums transition-colors duration-300',
                isCritical
                  ? 'text-bunker-danger animate-pulse'
                  : isUrgent
                    ? 'text-bunker-danger'
                    : 'text-bunker-text',
              ].join(' ')}
            >
              {formatTime(remaining)}
            </span>
          </div>
        ) : remaining === null && isHost ? (
          <button
            className="h-9 px-4 rounded bg-bunker-hot/20 border border-bunker-hot/50 text-bunker-hot font-inter text-sm hover:bg-bunker-hot/30 transition-colors duration-150"
            onClick={onStartTimer}
          >
            {t('game.debate.startTimer')}
          </button>
        ) : (
          <span className="font-inter text-xs text-bunker-muted/50">{t('game.debate.timeLeft')}: --:--</span>
        )}
      </div>

      {/* Host controls when timer is running */}
      {isHost && timerRunning && (
        <div className="flex gap-2 pt-1 border-t border-bunker-border">
          <button
            className="flex-1 h-9 rounded border border-bunker-border text-bunker-muted font-inter text-sm hover:border-bunker-hot/50 hover:text-bunker-text transition-colors duration-150"
            onClick={onExtend}
          >
            {t('game.debate.extendTime')}
          </button>
          <button
            className="flex-1 h-9 rounded bg-bunker-hot/15 border border-bunker-hot/50 text-bunker-hot font-inter text-sm hover:bg-bunker-hot/25 transition-colors duration-150"
            onClick={onForceVote}
          >
            {t('game.debate.skipToVote')}
          </button>
        </div>
      )}

      {/* Host "Start voting" when timer ended */}
      {isHost && showTimerEnded && (
        <button
          className="h-9 rounded bg-bunker-hot/15 border border-bunker-hot/50 text-bunker-hot font-inter text-sm hover:bg-bunker-hot/25 transition-colors duration-150"
          onClick={onForceVote}
        >
          {t('game.debate.skipToVote')}
        </button>
      )}

      {/* Speaking order */}
      {speakingOrder.length > 0 && (
        <div className="pt-1 border-t border-bunker-border">
          <div className="flex items-center justify-between mb-2">
            <p className="font-inter text-xs text-bunker-muted uppercase tracking-[0.06em]">
              {t('game.debate.speakingOrder')}
            </p>
            {(isHost || isCurrentSpeaker) && (
              <button
                className="h-7 px-2 rounded border border-bunker-border text-bunker-muted font-inter text-xs hover:border-bunker-hot/50 hover:text-bunker-text transition-colors duration-150"
                onClick={onNextSpeaker}
              >
                {t('game.debate.nextSpeaker')} →
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {speakingOrder.map((speaker, idx) => {
              const isCurrent = idx === currentSpeakerIndex;
              const isPast = idx < currentSpeakerIndex;
              return (
                <div
                  key={speaker.playerId}
                  className={[
                    'flex items-center gap-2 px-2 py-1.5 rounded transition-colors duration-150',
                    isCurrent
                      ? 'bg-bunker-hot/15 border border-bunker-hot/40'
                      : isPast
                        ? 'opacity-40'
                        : 'border border-transparent',
                  ].join(' ')}
                >
                  <span className={[
                    'font-mono text-xs w-5 text-right shrink-0',
                    isCurrent ? 'text-bunker-hot font-bold' : 'text-bunker-muted',
                  ].join(' ')}>
                    {idx + 1}.
                  </span>
                  <span className={[
                    'font-inter text-sm flex-1 truncate',
                    isCurrent ? 'text-bunker-text font-medium' : 'text-bunker-muted',
                  ].join(' ')}>
                    {speaker.nickname}
                  </span>
                  {isCurrent && (
                    <span className="font-inter text-xs text-bunker-hot shrink-0">
                      {t('game.debate.currentSpeaker')}
                    </span>
                  )}
                  {isPast && (
                    <span className="font-inter text-xs text-bunker-muted/50 shrink-0">✓</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
