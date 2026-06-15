// Reduce any phone string to its Greek "national key": the last 10 significant
// digits. This strips a +30 / 0030 / 30 country code and every separator, so a
// stored "69 1234 5678" and an inbound "+306912345678" collapse to the same key.
// Returns '' for anything under 10 digits (withheld / anonymous / junk).
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

// Build a tel: URI for a clickable call link. Numbers that already carry a +
// keep their country code; everything else is dialed exactly as stored (digits
// only — no country code is added). Returns null when there are too few digits.
export function phoneToTelHref(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  const onlyDigits = trimmed.replace(/[^0-9]/g, '');
  if (onlyDigits.length < 7) return null;
  if (trimmed.startsWith('+')) return `tel:+${onlyDigits}`;
  return `tel:${onlyDigits}`;
}
