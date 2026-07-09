import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useJobsForDeal } from '@/features/jobs/hooks/useJobsForDeal';
import { CommentsPanel } from './CommentsPanel';
import { dealChannelTabs, type ChannelTab, type CommentParentType } from './commentChannels';

const THREAD: Record<ChannelTab, CommentParentType> = {
  general: 'deal',
  dev: 'deal_dev',
  seo: 'deal_seo',
};
const LABEL: Record<ChannelTab, string> = { general: 'General', dev: 'Dev', seo: 'SEO' };

/** The deal page's Comments panel, tabbed per channel. Tabs appear only when
 *  the deal has matching jobs; a deal with none looks exactly like before. */
export function DealCommentsTabs({ dealId }: { dealId: string }) {
  const { data: jobs = [] } = useJobsForDeal(dealId);
  const tabs = dealChannelTabs(jobs);
  const [active, setActive] = useState<ChannelTab>('general');
  const current = tabs.includes(active) ? active : 'general';

  if (tabs.length === 1) {
    return <CommentsPanel parentType="deal" parentId={dealId} />;
  }

  return (
    <Tabs
      value={current}
      onValueChange={(v) => setActive(v as ChannelTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList className="mb-2 w-full shrink-0 justify-start">
        {tabs.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="text-xs">
            {LABEL[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab}
          value={tab}
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
        >
          <CommentsPanel parentType={THREAD[tab]} parentId={dealId} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
