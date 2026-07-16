import { describe, expect, it } from 'vitest';
import { awaitingLabelParty, resolveAction, type DualResolveState } from './dualResolve';

const CREATOR = 'creator-uuid';
const ASSIGNEE = 'assignee-uuid';
const OTHER = 'other-uuid';

function state(overrides: Partial<DualResolveState> = {}): DualResolveState {
  return {
    creatorResolvedAt: null,
    assigneeResolvedAt: null,
    creatorId: CREATOR,
    assigneeId: ASSIGNEE,
    closed: false,
    ...overrides,
  };
}

describe('resolveAction', () => {
  it('returns null for a non-party non-admin user', () => {
    expect(resolveAction(state(), OTHER, false)).toBeNull();
  });

  it('returns null when there is no user', () => {
    expect(resolveAction(state(), null, false)).toBeNull();
  });

  it('returns "resolve" for the assignee when nothing is stamped', () => {
    expect(resolveAction(state(), ASSIGNEE, false)).toBe('resolve');
  });

  it('returns "resolve" for the creator when nothing is stamped', () => {
    expect(resolveAction(state(), CREATOR, false)).toBe('resolve');
  });

  it('returns "confirm_close" for the assignee when the creator already stamped', () => {
    expect(
      resolveAction(state({ creatorResolvedAt: '2026-07-16T00:00:00Z' }), ASSIGNEE, false),
    ).toBe('confirm_close');
  });

  it('returns "confirm_close" for the creator when the assignee already stamped', () => {
    expect(
      resolveAction(state({ assigneeResolvedAt: '2026-07-16T00:00:00Z' }), CREATOR, false),
    ).toBe('confirm_close');
  });

  it('returns "withdraw" for a party who already stamped their own side (not closed)', () => {
    expect(
      resolveAction(state({ assigneeResolvedAt: '2026-07-16T00:00:00Z' }), ASSIGNEE, false),
    ).toBe('withdraw');
    expect(
      resolveAction(state({ creatorResolvedAt: '2026-07-16T00:00:00Z' }), CREATOR, false),
    ).toBe('withdraw');
  });

  it('returns "force_close" for an admin who is not a party', () => {
    expect(resolveAction(state(), OTHER, true)).toBe('force_close');
  });

  it('returns null when the task is already closed, even for a party', () => {
    expect(resolveAction(state({ closed: true }), ASSIGNEE, false)).toBeNull();
    expect(resolveAction(state({ closed: true }), CREATOR, false)).toBeNull();
  });

  it('returns null when closed, even for an admin', () => {
    expect(resolveAction(state({ closed: true }), OTHER, true)).toBeNull();
  });

  it('returns "resolve" for a self-task (creator === assignee) with nothing stamped', () => {
    const self = state({ creatorId: CREATOR, assigneeId: CREATOR });
    expect(resolveAction(self, CREATOR, false)).toBe('resolve');
  });

  it('returns "withdraw" for a self-task once the user has stamped their side', () => {
    const self = state({
      creatorId: CREATOR,
      assigneeId: CREATOR,
      creatorResolvedAt: '2026-07-16T00:00:00Z',
    });
    expect(resolveAction(self, CREATOR, false)).toBe('withdraw');
  });
});

describe('awaitingLabelParty', () => {
  it('returns "assignee" when only the creator has stamped', () => {
    expect(awaitingLabelParty(state({ creatorResolvedAt: '2026-07-16T00:00:00Z' }))).toBe(
      'assignee',
    );
  });

  it('returns "creator" when only the assignee has stamped', () => {
    expect(awaitingLabelParty(state({ assigneeResolvedAt: '2026-07-16T00:00:00Z' }))).toBe(
      'creator',
    );
  });

  it('returns null when neither side has stamped', () => {
    expect(awaitingLabelParty(state())).toBeNull();
  });

  it('returns null when both sides have stamped', () => {
    expect(
      awaitingLabelParty(
        state({
          creatorResolvedAt: '2026-07-16T00:00:00Z',
          assigneeResolvedAt: '2026-07-16T00:00:00Z',
        }),
      ),
    ).toBeNull();
  });

  it('returns null when the task is closed', () => {
    expect(
      awaitingLabelParty(state({ creatorResolvedAt: '2026-07-16T00:00:00Z', closed: true })),
    ).toBeNull();
  });
});
