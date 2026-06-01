/**
 * DebateTimer — countdown display with host controls.
 * Shows MM:SS format. Host-only: extend (+1 min) and force-vote buttons.
 */

import { t } from '../../i18n/t.js';

interface DebateTimerProps {
  remaining: number | null;
  isHost: boolean;
  onExtend: () => void;
  onForceVote: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function DebateTimer({
  remaining,
  isHost,
  onExtend,
  onForceVote,
}: DebateTimerProps): JSX.Element {
  const isUrgent = remaining !== null && remaining <= 30;

  return (
    <div className="bg-bunker-surface border border-bunker-border rounded p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-oswald font-bold text-sm text-bunker-muted uppercase tracking-wider">
          {t('game.debate.title')}
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="font-inter text-xs text-bunker-muted">{t('game.debate.timeLeft')}:</span>
          <span
            className={[
              'font-mono font-bold text-2xl tabular-nums',
              isUrgent ? 'text-bunker-danger' : 'text-bunker-text',
            ].join(' ')}
          >
            {remaining !== null ? formatTime(remaining) : '--:--'}
          </span>
        </div>
      </div>

      {/* Host controls */}
      {isHost && (
        <div className="flex gap-2 pt-1 border-t border-bunker-border">
          <button
            className="flex-1 h-10 rounded border border-bunker-border text-bunker-muted font-inter text-sm hover:border-bunker-hot/50 hover:text-bunker-text transition-colors duration-150"
            onClick={onExtend}
          >
            {t('game.debate.extendTime')}
          </button>
          <button
            className="flex-1 h-10 rounded bg-bunker-hot/15 border border-bunker-hot/50 text-bunker-hot font-inter text-sm hover:bg-bunker-hot/25 transition-colors duration-150"
            onClick={onForceVote}
          >
            {t('game.debate.skipToVote')}
          </button>
        </div>
      )}
    </div>
  );
}
