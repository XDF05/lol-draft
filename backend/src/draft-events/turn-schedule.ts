import { DraftPhase, Team } from './socket-events';

/**
 * The official 1v1 draft schedule per the spec (R-003 … R-007):
 *
 *   Ban Phase 1  (turns 1-6):  Blue/Red alternating, Blue first
 *   Pick Phase 1 (turns 7-12): B, R, R, B, B, R
 *   Ban Phase 2  (turns 13-16): R, B, R, B (Red first — counter-pick side)
 *   Pick Phase 2 (turns 17-20): R, B, B, R
 *   Finalization (turn 21):    60s swap grace period, no acting team
 *
 * TurnManager (T-009) reuses this table when advancing turns.
 */
export interface TurnInfo {
  turnNumber: number;
  phase: DraftPhase;
  actionType: 'BAN' | 'PICK' | 'FINALIZATION';
  expectedTeam: Team | null;
  timerSeconds: number;
}

export const TURN_TIMER_SECONDS = 30;
export const FINALIZATION_TIMER_SECONDS = 60;
/** Final action turn; turn 21 is the finalization grace period. */
export const LAST_ACTION_TURN = 20;
export const FINALIZATION_TURN = 21;
export const MAX_TURNS = FINALIZATION_TURN;

const SCHEDULE: ReadonlyArray<Omit<TurnInfo, 'turnNumber' | 'timerSeconds'>> = [
  // Ban Phase 1 — turns 1-6, Blue first (R-003)
  { phase: 'BANNING_P1', actionType: 'BAN', expectedTeam: 'BLUE' }, // 1
  { phase: 'BANNING_P1', actionType: 'BAN', expectedTeam: 'RED' }, // 2
  { phase: 'BANNING_P1', actionType: 'BAN', expectedTeam: 'BLUE' }, // 3
  { phase: 'BANNING_P1', actionType: 'BAN', expectedTeam: 'RED' }, // 4
  { phase: 'BANNING_P1', actionType: 'BAN', expectedTeam: 'BLUE' }, // 5
  { phase: 'BANNING_P1', actionType: 'BAN', expectedTeam: 'RED' }, // 6
  // Pick Phase 1 — turns 7-12 (R-004)
  { phase: 'PICKING_P1', actionType: 'PICK', expectedTeam: 'BLUE' }, // 7  first overall
  { phase: 'PICKING_P1', actionType: 'PICK', expectedTeam: 'RED' }, // 8
  { phase: 'PICKING_P1', actionType: 'PICK', expectedTeam: 'RED' }, // 9  Red advantage
  { phase: 'PICKING_P1', actionType: 'PICK', expectedTeam: 'BLUE' }, // 10
  { phase: 'PICKING_P1', actionType: 'PICK', expectedTeam: 'BLUE' }, // 11
  { phase: 'PICKING_P1', actionType: 'PICK', expectedTeam: 'RED' }, // 12
  // Ban Phase 2 — turns 13-16, Red first (R-005)
  { phase: 'BANNING_P2', actionType: 'BAN', expectedTeam: 'RED' }, // 13
  { phase: 'BANNING_P2', actionType: 'BAN', expectedTeam: 'BLUE' }, // 14
  { phase: 'BANNING_P2', actionType: 'BAN', expectedTeam: 'RED' }, // 15
  { phase: 'BANNING_P2', actionType: 'BAN', expectedTeam: 'BLUE' }, // 16
  // Pick Phase 2 — turns 17-20 (R-006)
  { phase: 'PICKING_P2', actionType: 'PICK', expectedTeam: 'RED' }, // 17 counter-pick
  { phase: 'PICKING_P2', actionType: 'PICK', expectedTeam: 'BLUE' }, // 18 Blue advantage
  { phase: 'PICKING_P2', actionType: 'PICK', expectedTeam: 'BLUE' }, // 19
  { phase: 'PICKING_P2', actionType: 'PICK', expectedTeam: 'RED' }, // 20
  // Finalization — turn 21 (R-007)
  { phase: 'FINALIZATION', actionType: 'FINALIZATION', expectedTeam: null },
];

/** Map a 1-based turn number to its phase/action/team/timer info. */
export function turnInfo(turnNumber: number): TurnInfo {
  const clamped = Math.min(Math.max(Math.round(turnNumber), 1), MAX_TURNS);
  const entry = SCHEDULE[clamped - 1];
  return {
    turnNumber: clamped,
    timerSeconds:
      entry.phase === 'FINALIZATION'
        ? FINALIZATION_TIMER_SECONDS
        : TURN_TIMER_SECONDS,
    ...entry,
  };
}

/** Initial `turn.start` payload derived from a draft record. */
export function initialTurnPayload(currentTurn: number): TurnInfo {
  return turnInfo(currentTurn);
}

/** Phase number (1 or 2) of the current ban phase, for ban bookkeeping. */
export function banPhaseOf(phase: DraftPhase): 1 | 2 {
  return phase === 'BANNING_P2' ? 2 : 1;
}
