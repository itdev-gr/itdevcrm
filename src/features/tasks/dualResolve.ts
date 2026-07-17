/**
 * Pure gating helpers for the dual-resolve task flow.
 *
 * A task carries two independent "resolved" stamps — one for the creator and
 * one for the assignee. The task closes only once BOTH parties have stamped
 * their side (or an admin force-closes it). These helpers decide what the
 * primary button does for the current viewer and who is still pending; the
 * actual state transitions live in the `resolve_task` / `unresolve_task` RPCs.
 */

export type DualResolveState = {
  creatorResolvedAt: string | null;
  assigneeResolvedAt: string | null;
  creatorId: string | null;
  assigneeId: string | null;
  closed: boolean;
};

/**
 * What the primary resolve button does for `uid`:
 * - `'resolve'`       — a party who hasn't stamped yet, and no one else has either
 * - `'confirm_close'` — a party who hasn't stamped, and the OTHER party already has
 *                       (their stamp will close the task)
 * - `'withdraw'`      — a party who already stamped their own side (un-stamp)
 * - `'force_close'`   — an admin who is not a party
 * - `null`            — hidden (task closed, or a non-party non-admin, or no user)
 *
 * A self-task (creator === assignee) collapses to the plain `'resolve'` /
 * `'withdraw'` path; a single stamp closes it at the RPC level either way.
 */
export function resolveAction(
  s: DualResolveState,
  uid: string | null,
  isAdmin: boolean,
): 'resolve' | 'confirm_close' | 'withdraw' | 'force_close' | null {
  if (s.closed || !uid) return null;
  const isCreator = uid === s.creatorId;
  const isAssignee = uid === s.assigneeId;
  if (!isCreator && !isAssignee) return isAdmin ? 'force_close' : null;
  const mineStamped =
    (isCreator && !!s.creatorResolvedAt) || (isAssignee && !!s.assigneeResolvedAt);
  if (mineStamped) return 'withdraw';
  const otherStamped = isCreator ? !!s.assigneeResolvedAt : !!s.creatorResolvedAt;
  const selfTask = s.creatorId === s.assigneeId;
  return otherStamped && !selfTask ? 'confirm_close' : 'resolve';
}

/**
 * Which party is still pending, for the "awaiting …" badge. Returns `null`
 * when the task is closed, neither side has stamped, or both have.
 */
export function awaitingLabelParty(s: DualResolveState): 'creator' | 'assignee' | null {
  if (s.closed) return null;
  if (s.creatorResolvedAt && !s.assigneeResolvedAt) return 'assignee';
  if (s.assigneeResolvedAt && !s.creatorResolvedAt) return 'creator';
  return null;
}

/**
 * True when `uid`'s own side is stamped while the task is still open — i.e.
 * finished FOR THIS USER, awaiting the other party. Open-task widgets hide
 * such rows for that user (the board's Resolved column shows them instead).
 * Assignee is checked first, mirroring `relationOf`.
 */
export function sideStampedFor(s: DualResolveState, uid: string | null): boolean {
  if (s.closed || !uid) return false;
  if (uid === s.assigneeId) return !!s.assigneeResolvedAt;
  if (uid === s.creatorId) return !!s.creatorResolvedAt;
  return false;
}

/**
 * i18n key for the popup shown when a resolve stamped only the caller's side
 * (`resolve_task` returned `closed: false`): the creator hears the assignee
 * hasn't resolved yet, and vice versa. `'both'` cannot arrive with
 * `closed: false`; it falls through to the awaiting-creator copy.
 */
export function awaitingPopupKey(yourSide: 'creator' | 'assignee' | 'both'): string {
  return yourSide === 'creator'
    ? 'tasks_page.resolve_awaiting_assignee'
    : 'tasks_page.resolve_awaiting_creator';
}
