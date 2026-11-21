'use client';

import { useDraftStore } from '../../store/draftStore';
import { useChampionData } from '../../hooks/useChampionData';
import type { Team } from '../../lib/socket';

function BanTeam({
  team,
  bans,
  champions,
}: {
  team: Team;
  bans: ReturnType<typeof useDraftStore.getState>['bans'];
  champions: ReturnType<typeof useChampionData>['champions'];
}) {
  const teamBans = bans
    .filter((ban) => ban.team === team)
    .sort((a, b) => a.phase - b.phase);
  const championById = new Map(
    champions.map((champion) => [champion.id, champion]),
  );

  return (
    <div className={`draft-ban-team ${team.toLowerCase()}`}>
      <span className="draft-ban-team-title">
        {team === 'BLUE' ? 'Blue bans' : 'Red bans'}
      </span>
      <div className="draft-ban-slots">
        {Array.from({ length: 5 }, (_, index) => {
          const ban = teamBans[index];
          const champion = ban ? championById.get(ban.championId) : undefined;
          return (
            <div
              key={ban ? `${ban.championId}-${index}` : `${team}-empty-${index}`}
              className="draft-ban-slot"
              title={
                champion
                  ? `${champion.name} (${team.toLowerCase()}, phase ${ban?.phase})`
                  : `Empty ${team.toLowerCase()} ban slot`
              }
            >
              {champion ? (
                <img src={champion.iconUrl} alt={champion.name} />
              ) : (
                <span aria-label={`Empty ${team.toLowerCase()} ban slot`}>
                  {index + 1}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The ten ban slots, placed directly below the champion pool. */
export default function DraftBans() {
  const bans = useDraftStore((state) => state.bans);
  const { champions } = useChampionData();

  return (
    <section className="draft-bans" aria-label="Banned champions">
      <div className="draft-bans-heading">
        <span>Bans</span>
        <span>{bans.length} of 10 locked</span>
      </div>
      <div className="draft-bans-teams">
        <BanTeam team="BLUE" bans={bans} champions={champions} />
        <BanTeam team="RED" bans={bans} champions={champions} />
      </div>
    </section>
  );
}
