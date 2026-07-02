export type SeoAccessConfig = {
  /** email_templates key the button sends. */
  templateKey: string;
  /** i18n key for the button title / aria-label. */
  requestKey: string;
  /** i18n key for the confirm dialog title. */
  confirmTitleKey: string;
  /** i18n key for the confirm dialog body (uses {{email}}). */
  confirmBodyKey: string;
};

/** The access-request email config for a service, or null when the service has none
 *  (so the button self-hides). local_seo → GBP, web_seo → GSC. */
export function seoAccessConfig(serviceType: string): SeoAccessConfig | null {
  if (serviceType === 'local_seo') {
    return {
      templateKey: 'localseo_gbp_access',
      requestKey: 'seo_access.gbp_request',
      confirmTitleKey: 'seo_access.gbp_confirm_title',
      confirmBodyKey: 'seo_access.gbp_confirm_body',
    };
  }
  if (serviceType === 'web_seo') {
    return {
      templateKey: 'webseo_gsc_access',
      requestKey: 'seo_access.gsc_request',
      confirmTitleKey: 'seo_access.gsc_confirm_title',
      confirmBodyKey: 'seo_access.gsc_confirm_body',
    };
  }
  return null;
}
