import type { ServiceType } from './hooks/useJobs';

// Boards where non-admin members may only see jobs assigned to them — the
// group-wide "All my group's" toggle is not offered and ?mine=0 is ignored.
// Owner request 2026-07-30 (social media reps work strictly their own jobs).
const OWNER_ONLY_BOARDS: ReadonlySet<ServiceType> = new Set<ServiceType>(['social_media']);

export function isOwnerOnlyBoard(serviceType: ServiceType): boolean {
  return OWNER_ONLY_BOARDS.has(serviceType);
}
