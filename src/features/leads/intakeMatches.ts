import type { LeadIntakeMatch } from './hooks/useLeadIntake';

/**
 * The subset of duplicate matches that point at an existing pipeline lead —
 * the only records the Merge action can append to (v1; customers are out of
 * scope). Count of 1 → direct merge; 2+ → the admin picks; 0 → Merge disabled.
 */
export function leadMatchesOf(matches: LeadIntakeMatch[]): LeadIntakeMatch[] {
  return matches.filter((m) => m.match_type === 'lead');
}

/** Lead matches whose target lead is currently in a cold stage (the re-engage
 *  candidates). `coldIds` comes from the `lead_cold_ids` RPC via useColdLeads. */
export function coldLeadMatchesOf(
  matches: LeadIntakeMatch[],
  coldIds: Set<string>,
): LeadIntakeMatch[] {
  return leadMatchesOf(matches).filter((m) => coldIds.has(m.record_id));
}
