// Notification types that surface as an on-screen toast when a matching
// `notifications` row is inserted for the current user. Keep this a readonly
// Set so adding a new toastable type is a one-line change.
const TOASTABLE_TYPES: ReadonlySet<string> = new Set([
  'task_assigned',
  'task_comment',
  'job_created',
  'job_archived',
  'task_confirm_pending',
  'lead_email_reply',
]);

// Pure predicate — true only for the toastable set above. Every other
// notification type (mention, task_started, task_resolved, payment_overdue, …)
// stays bell-only.
export function isToastable(type: string): boolean {
  return TOASTABLE_TYPES.has(type);
}
