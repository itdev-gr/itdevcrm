// Closed list of 20 major industries used as the dropdown source on lead /
// deal forms. Stored value = `code`; `labels` are bilingual for the UI.
// If a row in the DB has a legacy free-text industry that doesn't match
// a code, the form renders it as a one-off "(legacy)" option so the user
// can re-pick without losing data.

export type Industry = {
  code: string;
  labels: { en: string; el: string };
};

export const INDUSTRIES: Industry[] = [
  { code: 'technology', labels: { en: 'Technology / IT', el: 'Τεχνολογία / IT' } },
  { code: 'ecommerce', labels: { en: 'E-commerce', el: 'Ηλεκτρονικό εμπόριο' } },
  { code: 'retail', labels: { en: 'Retail', el: 'Λιανικό εμπόριο' } },
  { code: 'real_estate', labels: { en: 'Real Estate', el: 'Ακίνητα' } },
  { code: 'healthcare', labels: { en: 'Healthcare', el: 'Υγεία' } },
  { code: 'education', labels: { en: 'Education', el: 'Εκπαίδευση' } },
  { code: 'hospitality', labels: { en: 'Hospitality', el: 'Φιλοξενία' } },
  { code: 'food_beverage', labels: { en: 'Food & Beverage', el: 'Τρόφιμα & Ποτά' } },
  { code: 'tourism', labels: { en: 'Tourism', el: 'Τουρισμός' } },
  { code: 'construction', labels: { en: 'Construction', el: 'Κατασκευές' } },
  { code: 'automotive', labels: { en: 'Automotive', el: 'Αυτοκίνητο' } },
  { code: 'beauty_wellness', labels: { en: 'Beauty & Wellness', el: 'Ομορφιά & Ευεξία' } },
  { code: 'fitness_sports', labels: { en: 'Fitness & Sports', el: 'Γυμναστήριο & Αθλητισμός' } },
  { code: 'finance', labels: { en: 'Finance & Insurance', el: 'Χρηματοοικονομικά & Ασφάλιση' } },
  { code: 'legal', labels: { en: 'Legal Services', el: 'Νομικές Υπηρεσίες' } },
  { code: 'manufacturing', labels: { en: 'Manufacturing', el: 'Μεταποίηση' } },
  { code: 'marketing', labels: { en: 'Marketing & Advertising', el: 'Μάρκετινγκ & Διαφήμιση' } },
  { code: 'maritime', labels: { en: 'Maritime & Shipping', el: 'Ναυτιλία' } },
  { code: 'logistics', labels: { en: 'Logistics & Transport', el: 'Logistics & Μεταφορές' } },
  { code: 'other', labels: { en: 'Other', el: 'Άλλο' } },
];

export function industryLabel(code: string | null | undefined, lang: 'en' | 'el' = 'en'): string {
  if (!code) return '';
  return INDUSTRIES.find((i) => i.code === code)?.labels[lang] ?? code;
}
