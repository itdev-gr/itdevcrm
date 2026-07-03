// Shared recipient resolution for the document PDF endpoints
// (offer-pdf.ts, proforma-pdf.ts). Underscore prefix = not a Vercel route.

export type RecipientSource = {
  // clients use `name`; leads use `company_name` — accept either.
  name?: string | null;
  company_name?: string | null;
  email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
} | null;

export type OfferRecipient = {
  clientName: string;
  companyName: string | null;
  email: string | null;
};

/**
 * Resolve the name/company/email printed at the top of the document PDF.
 * Prefer a linked client; otherwise fall back to the originating lead — most
 * documents are drafted from a lead that has not been converted to a client
 * yet, so without this fallback the PDF header printed the literal "Client".
 */
export function resolveOfferRecipient(
  client: RecipientSource,
  lead: RecipientSource,
): OfferRecipient {
  const source = client ?? lead;
  if (!source) return { clientName: 'Client', companyName: null, email: null };
  const contact = [source.contact_first_name, source.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const company = source.name ?? source.company_name ?? null;
  return {
    clientName: contact || company || 'Client',
    companyName: company,
    email: source.email ?? null,
  };
}
