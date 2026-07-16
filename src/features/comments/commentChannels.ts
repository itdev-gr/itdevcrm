/** Thread identity stays (parent_type, parent_id) everywhere. Channels are
 *  extra parent types owned by the deal: 'deal_dev', 'deal_seo', 'deal_ads',
 *  'deal_social'. */
export type CommentParentType =
  | 'client'
  | 'deal'
  | 'job'
  | 'lead'
  | 'deal_dev'
  | 'deal_seo'
  | 'deal_ads'
  | 'deal_social';
export type ChannelTab = 'general' | 'dev' | 'seo' | 'ads' | 'social';
export type CommentThreadRef = { parentType: CommentParentType; parentId: string };

const SEO_SERVICES = new Set(['web_seo', 'local_seo', 'ai_seo']);

/** Thread parent_type behind each deal-channel tab. */
export const CHANNEL_THREAD: Record<ChannelTab, CommentParentType> = {
  general: 'deal',
  dev: 'deal_dev',
  seo: 'deal_seo',
  ads: 'deal_ads',
  social: 'deal_social',
};

export const CHANNEL_LABEL: Record<ChannelTab, string> = {
  general: 'General',
  dev: 'Dev',
  seo: 'SEO',
  ads: 'Ads',
  social: 'Social',
};

const LABEL_BY_PARENT: Partial<Record<CommentParentType, string>> = {
  deal_dev: 'Dev',
  deal_seo: 'SEO',
  deal_ads: 'Ads',
  deal_social: 'Social',
};

/** "Dev" / "SEO" / "Ads" / "Social" for a channel parent_type; null otherwise
 *  (used by the job page's "Shared with the deal — X thread" hint). */
export function channelLabelFor(parentType: CommentParentType): string | null {
  return LABEL_BY_PARENT[parentType] ?? null;
}

/** Which thread a job page shows: channel services share the deal's channel,
 *  everything else (hosting) keeps its private job thread. */
export function jobCommentThread(job: {
  id: string;
  deal_id: string;
  service_type: string;
}): CommentThreadRef {
  if (job.service_type === 'web_dev') return { parentType: 'deal_dev', parentId: job.deal_id };
  if (SEO_SERVICES.has(job.service_type)) return { parentType: 'deal_seo', parentId: job.deal_id };
  if (job.service_type === 'ads') return { parentType: 'deal_ads', parentId: job.deal_id };
  if (job.service_type === 'social_media')
    return { parentType: 'deal_social', parentId: job.deal_id };
  return { parentType: 'job', parentId: job.id };
}

/** Which tabs the deal comments panel shows for its (non-archived) jobs. */
export function dealChannelTabs(jobs: ReadonlyArray<{ service_type: string }>): ChannelTab[] {
  const tabs: ChannelTab[] = ['general'];
  if (jobs.some((j) => j.service_type === 'web_dev')) tabs.push('dev');
  if (jobs.some((j) => SEO_SERVICES.has(j.service_type))) tabs.push('seo');
  if (jobs.some((j) => j.service_type === 'ads')) tabs.push('ads');
  if (jobs.some((j) => j.service_type === 'social_media')) tabs.push('social');
  return tabs;
}
