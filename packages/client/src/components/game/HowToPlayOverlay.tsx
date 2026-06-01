/**
 * HowToPlayOverlay — dismissable game rules summary.
 * Opened from the help icon in the game header or lobby.
 * Covers: 3 rounds, reveal/debate/vote flow, survival goal.
 *
 * All strings from uk.json — no hardcoded Ukrainian.
 */

import { X } from 'lucide-react';
import { t } from '../../i18n/t.js';

interface HowToPlayOverlayProps {
  onClose: () => void;
}

export function HowToPlayOverlay({ onClose }: HowToPlayOverlayProps): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 overflow-y-auto py-8"
      role="dialog"
      aria-modal="true"
      aria-label={t('howToPlay.title')}
    >
      <div className="bg-bunker-surface border border-bunker-border rounded w-full max-w-lg mx-4 animate-[fade-in_300ms_ease-out]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bunker-border">
          <h2 className="font-oswald font-bold text-xl text-bunker-text uppercase tracking-wider">
            {t('howToPlay.title')}
          </h2>
          <button
            className="p-1 text-bunker-muted hover:text-bunker-text transition-colors duration-150"
            onClick={onClose}
            aria-label={t('howToPlay.close')}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Goal */}
          <Section title={t('howToPlay.goal.title')}>
            <p className="font-inter text-sm text-bunker-muted leading-relaxed">
              {t('howToPlay.goal.body')}
            </p>
          </Section>

          {/* Rounds */}
          <Section title={t('howToPlay.rounds.title')}>
            <div className="flex flex-col gap-2">
              <RoundRow icon="📋" label={t('howToPlay.rounds.reveal')} />
              <RoundRow icon="💬" label={t('howToPlay.rounds.debate')} />
              <RoundRow icon="🗳️" label={t('howToPlay.rounds.vote')} />
            </div>
          </Section>

          {/* Reveals */}
          <Section title={t('howToPlay.reveals.title')}>
            <p className="font-inter text-sm text-bunker-muted leading-relaxed">
              {t('howToPlay.reveals.body')}
            </p>
          </Section>

          {/* Voting rules */}
          <Section title={t('howToPlay.voting.title')}>
            <ul className="flex flex-col gap-1.5 list-none">
              {[
                t('howToPlay.voting.openVote'),
                t('howToPlay.voting.noSelfVote'),
                t('howToPlay.voting.oneVotePerRound'),
                t('howToPlay.voting.tie'),
              ].map((rule) => (
                <li key={rule} className="font-inter text-sm text-bunker-muted flex gap-2">
                  <span className="text-bunker-hot shrink-0">•</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </Section>

          {/* Character */}
          <Section title={t('howToPlay.character.title')}>
            <p className="font-inter text-sm text-bunker-muted leading-relaxed">
              {t('howToPlay.character.body')}
            </p>
          </Section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-bunker-border">
          <button
            className="w-full h-11 rounded bg-bunker-hot text-white font-oswald font-semibold text-sm uppercase tracking-wider hover:bg-bunker-glow transition-colors duration-150"
            onClick={onClose}
          >
            {t('howToPlay.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <h3 className="font-oswald font-semibold text-sm text-bunker-hot uppercase tracking-wider mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

function RoundRow({ icon, label }: { icon: string; label: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded bg-bunker-bg border border-bunker-border/50">
      <span className="text-lg shrink-0">{icon}</span>
      <span className="font-inter text-sm text-bunker-muted">{label}</span>
    </div>
  );
}
