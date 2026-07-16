export type AreaKind = 'svc_local' | 'svc_web' | 'svc_webdev' | 'svc_ads' | 'svc_social';
export type AreaGroup = 'local_seo' | 'web_seo' | 'web_dev' | 'ads' | 'social_media';

export type ServiceArea = {
  kind: AreaKind;
  labelEn: string;
  labelEl: string;
  groupCode: AreaGroup;
};

export const LOCAL_AREA: ServiceArea = { kind: 'svc_local', labelEn: 'Local SEO', labelEl: 'Local SEO', groupCode: 'local_seo' };
export const WEB_AREA: ServiceArea = { kind: 'svc_web', labelEn: 'Web SEO', labelEl: 'Web SEO', groupCode: 'web_seo' };
export const WEBDEV_AREA: ServiceArea = { kind: 'svc_webdev', labelEn: 'Web Dev', labelEl: 'Web Dev', groupCode: 'web_dev' };
export const ADS_AREA: ServiceArea = { kind: 'svc_ads', labelEn: 'Ads', labelEl: 'Ads', groupCode: 'ads' };
export const SOCIAL_AREA: ServiceArea = { kind: 'svc_social', labelEn: 'Social Media', labelEl: 'Social Media', groupCode: 'social_media' };

export const SERVICE_AREA_KINDS: AreaKind[] = ['svc_local', 'svc_web', 'svc_webdev', 'svc_ads', 'svc_social'];
const BY_KIND: Record<AreaKind, ServiceArea> = {
  svc_local: LOCAL_AREA,
  svc_web: WEB_AREA,
  svc_webdev: WEBDEV_AREA,
  svc_ads: ADS_AREA,
  svc_social: SOCIAL_AREA,
};

export function areaForKind(kind: string): ServiceArea | null {
  return (SERVICE_AREA_KINDS as string[]).includes(kind) ? BY_KIND[kind as AreaKind] : null;
}

export function areasForJob(job: { service_type: string }): ServiceArea[] {
  switch (job.service_type) {
    case 'local_seo':
      return [LOCAL_AREA];
    case 'web_seo':
      return [WEB_AREA];
    case 'web_dev':
      return [WEBDEV_AREA];
    case 'ads':
      return [ADS_AREA];
    case 'social_media':
      return [SOCIAL_AREA];
    default:
      // The ai_seo PARENT shows no area — its Local/Web files live on the
      // local_seo / web_seo CHILD jobs (parent_job_id set), which the Local/Web
      // teams actually open from their boards. Those children match the cases
      // above by service_type, so they get their area automatically.
      return [];
  }
}

export function canUploadArea(isAdmin: boolean, groupCodes: string[], area: ServiceArea): boolean {
  return isAdmin || groupCodes.includes(area.groupCode);
}
