import type { DraftSessionSnapshot } from '../lib/socket';
import { useDraftStore } from './draftStore';

const snapshot = (
  overrides: Partial<DraftSessionSnapshot> = {},
): DraftSessionSnapshot => ({
  draftId: 1,
  code: 'ABC123',
  status: 'IN_PROGRESS',
  currentTurn: 1,
  bans: [],
  picks: [],
  pending: {},
  skips: { BLUE: 0, RED: 0 },
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('draftStore staged-selection privacy', () => {
  beforeEach(() => {
    useDraftStore.getState().resetSession();
  });

  it('keeps local staged state when a sanitized room snapshot arrives', () => {
    const store = useDraftStore.getState();
    store.applyDraftPending({
      draftId: 1,
      team: 'BLUE',
      pending: { type: 'BAN', championId: 'Ahri' },
    });

    store.applyDraftUpdate(snapshot({ pending: {} }));

    expect(useDraftStore.getState().pending.BLUE).toEqual({
      type: 'BAN',
      championId: 'Ahri',
    });
  });

  it('applies private staged state for the owning team', () => {
    useDraftStore.getState().applyDraftPending({
      draftId: 1,
      team: 'RED',
      pending: { type: 'PICK', championId: 'Jinx' },
    });

    expect(useDraftStore.getState().pending.RED).toEqual({
      type: 'PICK',
      championId: 'Jinx',
    });
    expect(useDraftStore.getState().pending.BLUE).toBeUndefined();
  });
});
