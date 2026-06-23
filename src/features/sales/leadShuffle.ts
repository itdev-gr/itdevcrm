export interface ShuffleLead {
  id: string;
  /** Current owner (the rep the lead must NOT be returned to), or null if unassigned. */
  ownerId: string | null;
}

export interface ShuffleAssignment {
  leadId: string;
  newOwnerId: string;
}

/**
 * Re-distribute a set of leads across the sales pool so that:
 *  - no lead is given back to the rep who currently owns it (hard rule), and
 *  - every rep receives as close to an equal share as possible.
 *
 * Strategy: cluster leads by current owner, lay down a balanced round-robin base
 * assignment (per-rep counts differ by at most 1), then repair any self-assignment
 * by swapping its target with another lead's. A swap preserves both reps' counts,
 * so balance survives the repair. In the rare case where no count-preserving swap
 * exists (e.g. one rep owns nearly every lead in the stage), the conflicting lead
 * is moved to the least-loaded non-self rep — trading a small imbalance for the
 * no-self guarantee, which is the higher-priority rule.
 *
 * Deterministic: same input -> same output (no randomness), so it is unit testable
 * and the result is reproducible.
 *
 * @throws Error('shuffle_needs_two_reps') if the pool has fewer than two reps.
 */
export function planLeadShuffle(leads: ShuffleLead[], pool: string[]): ShuffleAssignment[] {
  if (pool.length < 2) {
    throw new Error('shuffle_needs_two_reps');
  }
  const n = pool.length;

  // Cluster by current owner so the round-robin spreads each owner's leads across
  // different reps; tiebreak by id for a stable, deterministic order.
  const ordered = [...leads].sort((a, b) => {
    const ao = a.ownerId ?? '';
    const bo = b.ownerId ?? '';
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  // Balanced base assignment (counts differ by at most 1).
  const assigned: string[] = ordered.map((_, k) => pool[k % n]);

  const isConflict = (k: number) => assigned[k] === ordered[k].ownerId;

  for (let k = 0; k < ordered.length; k++) {
    if (!isConflict(k)) continue;

    let swapped = false;
    for (let j = 0; j < ordered.length; j++) {
      if (j === k) continue;
      // After a swap, lead k takes assigned[j] and lead j takes assigned[k].
      if (assigned[j] === ordered[k].ownerId) continue; // k would still conflict
      if (assigned[k] === ordered[j].ownerId) continue; // j would newly conflict
      [assigned[k], assigned[j]] = [assigned[j], assigned[k]];
      swapped = true;
      break;
    }

    if (!swapped) {
      // No count-preserving swap exists: move to the least-loaded non-self rep.
      const load = new Map<string, number>(pool.map((p) => [p, 0]));
      for (const a of assigned) load.set(a, (load.get(a) ?? 0) + 1);
      let best: string | null = null;
      for (const p of pool) {
        if (p === ordered[k].ownerId) continue;
        if (best === null || load.get(p)! < load.get(best)!) best = p;
      }
      if (best) assigned[k] = best;
    }
  }

  return ordered.map((lead, k) => ({ leadId: lead.id, newOwnerId: assigned[k] }));
}
