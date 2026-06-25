import { useEffect } from 'react';

/** The static tab title used everywhere outside the record detail pages. */
export const DEFAULT_DOCUMENT_TITLE = 'IT DEV - CRM';

/**
 * Build a browser-tab title for a record detail page, e.g. `Acme Corp · Job 000013-WEBSEO`.
 * Returns `undefined` when there is no name yet (data still loading), so the caller
 * leaves the default app title in place rather than flashing a half-built string.
 */
export function formatPageTitle(
  name: string | null | undefined,
  type: string,
  code?: string | null,
): string | undefined {
  const trimmedName = name?.trim();
  if (!trimmedName) return undefined;

  const trimmedCode = code?.trim();
  return trimmedCode ? `${trimmedName} · ${type} ${trimmedCode}` : `${trimmedName} · ${type}`;
}

/**
 * Set the browser-tab title while a component is mounted, restoring the default
 * app title when it unmounts (i.e. when the user navigates away). Passing an
 * empty/undefined title keeps whatever title is currently showing.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const next = title?.trim();
    if (next) document.title = next;
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [title]);
}
