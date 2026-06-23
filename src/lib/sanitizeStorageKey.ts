/**
 * Reduce a filename to a Supabase Storage–safe key segment.
 *
 * Supabase Storage rejects object keys containing characters outside a limited
 * ASCII set with an "Invalid key" error — notably Greek letters and other
 * non-ASCII, so a raw filename like "Τιμολόγιο.pdf" fails to upload. The
 * original, human-readable name is stored separately (e.g. attachments.file_name)
 * for display and download, so the storage key itself only needs to be valid and
 * unique — callers prefix it with a timestamp / uuid.
 */
export function sanitizeStorageFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}
