// Shared service-type labels for the offer/pro-forma builders and the offer
// email composer (previously duplicated in OfferBuilderPage/ProFormaBuilderPage).

export const CATEGORY_LABELS: Record<string, { en: string; el: string }> = {
  web_seo: { en: 'Web SEO', el: 'Web SEO' },
  local_seo: { en: 'Local SEO', el: 'Local SEO' },
  web_dev: { en: 'Web Development', el: 'Ανάπτυξη Ιστοσελίδων' },
  social_media: { en: 'Social Media', el: 'Social Media' },
  ai_seo: { en: 'AI SEO', el: 'AI SEO' },
  hosting: { en: 'Hosting', el: 'Φιλοξενία' },
  ads: { en: 'Ads', el: 'Διαφημίσεις' },
  maintenance: { en: 'Support', el: 'Υποστήριξη' },
  franchise: { en: 'Franchise', el: 'Franchise' },
  domains: { en: 'Domains', el: 'Domains' },
};

export const SERVICE_TYPES = Object.keys(CATEGORY_LABELS);

export function categoryLabel(serviceType: string, lang: 'en' | 'el' = 'el'): string {
  return CATEGORY_LABELS[serviceType]?.[lang] ?? serviceType;
}
