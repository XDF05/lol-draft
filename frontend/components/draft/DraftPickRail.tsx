'use client';

import { useDraftStore } from '../../store/draftStore';
import { useChampionData } from '../../hooks/useChampionData';
import type { Team } from '../../lib/socket';

function EmptyPortrait() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 5c-8.8 0-15 6.4-15 15v8c0 3.7 2.7 6.8 6.3 7.5v4.2c0 1.8 1.5 3.3 3.3 3.3h10.8c1.8 0 3.3-1.5 3.3-3.3v-4.2c3.6-.7 6.3-3.8 6.3-7.5v-8C39 11.4 32.8 5 24 5Zm-7.3 16.2c-2.1-.5-3.7-2.4-3.7-4.7 0-1.2.4-2.3 1.1-3.2.5 2.6 2.1 4.1 4.2 4.8-.5 1.1-.9 2.1-1.6 3.1Zm14.6 0c-.7-1-1.1-2-1.6-3.1 2.1-.7 3.7-2.2 4.2-4.8.7.9 1.1 2 1.1 3.2 0 2.3-1.6 4.2-3.7 4.7ZM24 18.5c-3.2 0-5.7-2.2-5.7-5s2.5-5 5.7-5 5.7 2.2 5.7 5-2.5 5-5.7 5Z" />
    </svg>
  );
}

/** The five pick slots shown on either side of the champion pool. */
export default function DraftPickRail({
  team,
  myTeam,
}: {
  team: Team;
  myTeam: Team | null;
}) {
  const picks = useDraftStore((state) => state.picks);
  const { champions } = useChampionData();
  const championById = new Map(
    champions.map((champion) => [champion.id, champion]),
  );
  const teamPicks = picks.filter((pick) => pick.team === team);
  const prefix = team === 'BLUE' ? 'B' : 'R';

  return (
    <aside className={`draft-pick-rail ${team.toLowerCase()}`}>
      <div className="draft-pick-rail-title">
        {team === 'BLUE' ? 'Blue picks' : 'Red picks'}
        {myTeam === team ? ' · you' : ''}
      </div>
      {Array.from({ length: 5 }, (_, index) => {
        const pick = teamPicks[index];
        const champion = pick ? championById.get(pick.championId) : undefined;
        return (
          <div
            key={pick ? pick.id : `${team}-empty-${index}`}
            className={`draft-pick-slot${champion ? '' : ' empty'}`}
            title={
              champion ? champion.name : `Empty ${team.toLowerCase()} pick slot`
            }
          >
            <span className="draft-pick-label">
              {prefix}
              {index + 1}
            </span>
            {champion ? (
              <span className="draft-pick-portrait">
                <img src={champion.iconUrl} alt={champion.name} />
              </span>
            ) : (
              <span className="draft-empty-portrait">
                <EmptyPortrait />
              </span>
            )}
            <span className="draft-pick-name">{champion?.name ?? ''}</span>
          </div>
        );
      })}
    </aside>
  );
}
