export type AreaKind = 'svc_local' | 'svc_web' | 'svc_webdev';
export type AreaGroup = 'local_seo' | 'web_seo' | 'web_dev';

export type ServiceArea = {
  kind: AreaKind;
  labelEn: string;
  labelEl: string;
  groupCode: AreaGroup;
};

export const LOCAL_AREA: ServiceArea = { kind: 'svc_local', labelEn: 'Local SEO', labelEl: 'Local SEO', groupCode: 'local_seo' };
export const WEB_AREA: ServiceArea = { kind: 'svc_web', labelEn: 'Web SEO', labelEl: 'Web SEO', groupCode: 'web_seo' };
export const WEBDEV_AREA: ServiceArea = { kind: 'svc_webdev', labelEn: 'Web Dev', labelEl: 'Web Dev', groupCode: 'web_dev' };

export const SERVICE_AREA_KINDS: AreaKind[] = ['svc_local', 'svc_web', 'svc_webdev'];
const BY_KIND: Record<AreaKind, ServiceArea> = {
  svc_local: LOCAL_AREA,
  svc_web: WEB_AREA,
  svc_webdev: WEBDEV_AREA,
};

export function areaForKind(kind: string): ServiceArea | null {
  return (SERVICE_AREA_KINDS as string[]).includes(kind) ? BY_KIND[kind as AreaKind] : null;
}

export function areasForJob(job: { service_type: string; parent_job_id: string | null }): ServiceArea[] {
  if (job.parent_job_id != null) return [];
  switch (job.service_type) {
    case 'ai_seo':
      return [LOCAL_AREA, WEB_AREA];
    case 'local_seo':
      return [LOCAL_AREA];
    case 'web_seo':
      return [WEB_AREA];
    case 'web_dev':
      return [WEBDEV_AREA];
    default:
      return [];
  }
}

export function canUploadArea(isAdmin: boolean, groupCodes: string[], area: ServiceArea): boolean {
  return isAdmin || groupCodes.includes(area.groupCode);
}
