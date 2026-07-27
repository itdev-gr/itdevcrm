import { describe, expect, it } from 'vitest';
import { awaitingLabelParty, awaitingPopupKey, resolveAction, sideStampedFor, type DualResolveState } from './dualResolve';
import { cardDualResolveState, type TaskCard } from './taskCard';

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

describe('awaitingPopupKey', () => {
  it('creator stamped → popup says the assignee has not resolved yet', () => {
    expect(awaitingPopupKey('creator')).toBe('tasks_page.resolve_awaiting_assignee');
  });
  it('assignee stamped → popup says awaiting the creator', () => {
    expect(awaitingPopupKey('assignee')).toBe('tasks_page.resolve_awaiting_creator');
  });
});

describe('sideStampedFor', () => {
  const base = {
    creatorResolvedAt: null, assigneeResolvedAt: null,
    creatorId: 'C', assigneeId: 'A', closed: false,
  };
  it('assignee with own stamp on an open task → true', () => {
    expect(sideStampedFor({ ...base, assigneeResolvedAt: '2026-07-01T00:00:00Z' }, 'A')).toBe(true);
  });
  it('creator when only the assignee stamped → false', () => {
    expect(sideStampedFor({ ...base, assigneeResolvedAt: '2026-07-01T00:00:00Z' }, 'C')).toBe(false);
  });
  it('closed task → false (terminal rows are not widget rows)', () => {
    expect(sideStampedFor({ ...base, assigneeResolvedAt: '2026-07-01T00:00:00Z', closed: true }, 'A')).toBe(false);
  });
  it('non-party or missing uid → false', () => {
    expect(sideStampedFor({ ...base, creatorResolvedAt: '2026-07-01T00:00:00Z' }, 'X')).toBe(false);
    expect(sideStampedFor(base, null)).toBe(false);
  });
});

describe('cardDualResolveState', () => {
  const baseCard: TaskCard = {
    key: 'user:u1', kind: 'user', id: 'u1', title: 'T', importance: 'low',
    relation: 'mine', resolved: false, assigneeId: ASSIGNEE, creatorId: CREATOR,
    createdAtIso: null, dueAt: null, resolvedAt: null, startedAtIso: null,
    sourceCode: null, link: null, notes: null, clientName: null, clientId: null, leadName: null,
    creatorResolvedAt: null, assigneeResolvedAt: null, summary: null,
  };

  it('projects a card onto its dual-resolve state (closed mirrors resolved)', () => {
    const c: TaskCard = {
      ...baseCard,
      resolved: true,
      creatorResolvedAt: '2026-07-16T00:00:00Z',
      assigneeResolvedAt: '2026-07-16T00:00:00Z',
    };
    expect(cardDualResolveState(c)).toEqual({
      creatorResolvedAt: '2026-07-16T00:00:00Z',
      assigneeResolvedAt: '2026-07-16T00:00:00Z',
      creatorId: CREATOR,
      assigneeId: ASSIGNEE,
      closed: true,
    });
  });

  it('feeds resolveAction so a half-resolved card offers the right action', () => {
    const stamped: TaskCard = { ...baseCard, assigneeResolvedAt: '2026-07-16T00:00:00Z' };
    // assignee already stamped → withdraw; creator sees confirm_close
    expect(resolveAction(cardDualResolveState(stamped), ASSIGNEE, false)).toBe('withdraw');
    expect(resolveAction(cardDualResolveState(stamped), CREATOR, false)).toBe('confirm_close');
    expect(awaitingLabelParty(cardDualResolveState(stamped))).toBe('creator');
  });
});
