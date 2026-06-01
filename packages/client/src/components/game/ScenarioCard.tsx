/**
 * ScenarioCard — displays the apocalypse scenario in a persistent panel.
 * Shown throughout all game phases.
 */

import type { Scenario } from '@bunker/shared';
import { t } from '../../i18n/t.js';

interface ScenarioCardProps {
  scenario: Scenario;
  collapsed?: boolean;
}

export function ScenarioCard({ scenario, collapsed }: ScenarioCardProps): JSX.Element {
  if (collapsed) {
    return (
      <div className="px-4 py-2 bg-bunker-surface border border-bunker-border rounded flex items-center gap-2">
        <span className="text-bunker-hot text-sm">☢</span>
        <span className="font-oswald font-semibold text-sm text-bunker-text uppercase tracking-wide">
          {scenario.title}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-bunker-surface border border-bunker-border rounded p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-bunker-hot">☢</span>
        <h3 className="font-oswald font-bold text-base text-bunker-hot uppercase tracking-wider">
          {t('game.scenario')}
        </h3>
      </div>

      <p className="font-oswald font-semibold text-lg text-bunker-text">
        {scenario.title}
      </p>

      <p className="font-inter text-sm text-bunker-muted leading-relaxed">
        {scenario.description}
      </p>

      <div className="border-t border-bunker-border pt-3">
        <p className="font-inter text-xs text-bunker-muted uppercase tracking-[0.08em] mb-2">
          {t('game.bunkerConditions')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="font-mono text-xs text-bunker-muted">{t('game.capacity')}</p>
            <p className="font-oswald text-lg text-bunker-hot">{scenario.bunkerConditions.capacity}</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-xs text-bunker-muted">{t('game.supplyDuration')}</p>
            <p className="font-oswald text-sm text-bunker-text">{scenario.bunkerConditions.supplyDuration}</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-xs text-bunker-muted">{t('game.outsideEnvironment')}</p>
            <p className="font-oswald text-sm text-bunker-text leading-tight">
              {scenario.bunkerConditions.outsideEnvironment}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
