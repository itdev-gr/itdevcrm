/** A stage is blocked for the current user when it is restricted to someone else. */
export function isStageMoveBlocked(
  stage: { restricted_to_user_id: string | null },
  currentUserId: string | null,
): boolean {
  return stage.restricted_to_user_id != null && stage.restricted_to_user_id !== currentUserId;
}
