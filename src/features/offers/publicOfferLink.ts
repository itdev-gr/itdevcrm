// Public no-login offer link base — /o/<public_token> is rewritten by
// vercel.json to api/offer-view.ts, which streams the offer PDF.
// Hardcoded prod origin, same convention as PUBLIC_FORM_BASE for the intake
// form (ClientIntakeSection.tsx): emailed links must never carry a preview or
// localhost origin.
export const PUBLIC_OFFER_BASE = 'https://www.itdevcrm.com/o/';

export function publicOfferUrl(publicToken: string): string {
  return `${PUBLIC_OFFER_BASE}${publicToken}`;
}
