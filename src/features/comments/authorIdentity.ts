export type DirectoryEntry = { full_name: string | null; email: string };
export type ResolvedAuthor = { name: string | null; email: string };

/**
 * Resolve a comment author's display identity (name + email).
 *
 * `profiles` RLS (`profiles_select_self_or_admin`) only lets a non-admin read
 * their OWN row, so the embedded `author` join is null for every other user and
 * the UI used to fall back to the raw `author_id` UUID. The security-definer
 * `profile_directory()` map (readable by all staff) is the authoritative source;
 * the embedded row is a fallback for before the directory loads. The author id
 * is used only as a last resort when no name or email is known anywhere.
 */
export function resolveAuthorIdentity(
  authorId: string,
  embedded: { full_name?: string | null; email?: string | null } | null | undefined,
  directory?: Map<string, DirectoryEntry> | null,
): ResolvedAuthor {
  const dir = directory?.get(authorId);
  const name = (dir?.full_name ?? embedded?.full_name)?.trim() || null;
  const email = dir?.email || embedded?.email || authorId;
  return { name, email };
}
