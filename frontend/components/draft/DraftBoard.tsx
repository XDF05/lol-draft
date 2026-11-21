'use client';

import { useDraftStore } from '../../store/draftStore';
import type { Team } from '../../lib/socket';
import BanPhase from './BanPhase';
import PickPhase from './PickPhase';
import FinalizationPhase from './FinalizationPhase';
import DraftBans from './DraftBans';
import DraftPickRail from './DraftPickRail';

/**
 * The live draft board. The split blue/red header and the pick rails mirror
 * the reference layout, while the searchable champion pool remains the
 * focal point in the centre.
 */
export default function DraftBoard({
  bluePlayer,
  redPlayer,
  myTeam,
}: {
  bluePlayer?: string | null;
  redPlayer?: string | null;
  myTeam: Team | null;
}) {
  const currentTurnInfo = useDraftStore((state) => state.currentTurnInfo);
  const phase = currentTurnInfo?.phase;

  return (
    <section className="draft-board" aria-label="Live draft board">
      <div className="draft-side-banner">
        <div className="blue">
          <span>Blue side</span>
          <span className="side-player">{bluePlayer ?? 'Waiting…'}</span>
        </div>
        <div className="red">
          <span>Red side</span>
          <span className="side-player">{redPlayer ?? 'Waiting…'}</span>
        </div>
      </div>

      <div className="draft-board-grid">
        <DraftPickRail team="BLUE" myTeam={myTeam} />

        <div className="draft-board-main">
          {phase?.startsWith('BANNING') && <BanPhase />}
          {phase?.startsWith('PICKING') && <PickPhase />}
          {phase === 'FINALIZATION' && <FinalizationPhase />}
          {!phase && <div className="phase-empty">Syncing draft state…</div>}
          <DraftBans />
        </div>

        <DraftPickRail team="RED" myTeam={myTeam} />
      </div>
    </section>
  );
}
