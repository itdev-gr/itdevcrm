/** Thread identity stays (parent_type, parent_id) everywhere. Channels are
 *  just two extra parent types owned by the deal: 'deal_dev' and 'deal_seo'. */
export type CommentParentType = 'client' | 'deal' | 'job' | 'lead' | 'deal_dev' | 'deal_seo';
export type ChannelTab = 'general' | 'dev' | 'seo';
export type CommentThreadRef = { parentType: CommentParentType; parentId: string };

const SEO_SERVICES = new Set(['web_seo', 'local_seo', 'ai_seo']);

/** Which thread a job page shows: web_dev -> the deal's Dev channel,
 *  any SEO flavor -> the deal's SEO channel, everything else keeps
 *  its private job thread. */
export function jobCommentThread(job: {
  id: string;
  deal_id: string;
  service_type: string;
}): CommentThreadRef {
  if (job.service_type === 'web_dev') return { parentType: 'deal_dev', parentId: job.deal_id };
  if (SEO_SERVICES.has(job.service_type)) return { parentType: 'deal_seo', parentId: job.deal_id };
  return { parentType: 'job', parentId: job.id };
}

/** Which tabs the deal comments panel shows for its (non-archived) jobs. */
export function dealChannelTabs(jobs: ReadonlyArray<{ service_type: string }>): ChannelTab[] {
  const tabs: ChannelTab[] = ['general'];
  if (jobs.some((j) => j.service_type === 'web_dev')) tabs.push('dev');
  if (jobs.some((j) => SEO_SERVICES.has(j.service_type))) tabs.push('seo');
  return tabs;
}
