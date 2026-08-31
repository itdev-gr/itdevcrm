import type { TFunction } from 'i18next';

// convert_lead_to_client returns error codes that are either plain i18n keys
// ('value_required') or parameterized as 'service_amount_required:<service_type>'
// (migration 20260831210000 — an unpriced planned service blocks the convert).
export function formatConvertErrors(errors: string[], t: TFunction): string {
  return errors
    .map((code) => {
      const sep = code.indexOf(':');
      if (sep > 0) {
        const key = code.slice(0, sep);
        const param = code.slice(sep + 1);
        return t(`convert.errors.${key}`, {
          service: param.replace(/_/g, ' '),
          defaultValue: code,
        });
      }
      return t(`convert.errors.${code}`, { defaultValue: code });
    })
    .join('\n');
}
