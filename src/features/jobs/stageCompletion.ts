// Single source of truth for "does moving a job into this stage complete it?".
// A job is completed only by a terminal stage whose outcome is 'completed'
// (e.g. Web SEO/Local SEO "Done", Web Dev "Live") — not by terminal stages
// with other outcomes like 'cancelled'. Used by both the kanban board and the
// job detail page so completion is stamped consistently from either surface.
export function stageCompletesJob(
  stage?: { is_terminal?: boolean | null; terminal_outcome?: string | null } | null,
): boolean {
  return !!stage?.is_terminal && stage.terminal_outcome === 'completed';
}
