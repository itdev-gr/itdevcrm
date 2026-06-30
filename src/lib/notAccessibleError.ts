// A typed error for the case where a Supabase row fetch returns zero rows —
// usually because RLS hides the row from the current viewer. Detail pages
// check err.name === 'NotAccessible' to render a friendly empty state instead
// of the raw "Cannot coerce the result to a single JSON object" message.
export function notAccessibleError(): Error {
  const err = new Error('not-accessible');
  err.name = 'NotAccessible';
  return err;
}

export function isNotAccessible(err: unknown): boolean {
  return err instanceof Error && err.name === 'NotAccessible';
}
