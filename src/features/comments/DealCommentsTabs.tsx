import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useJobsForDeal } from '@/features/jobs/hooks/useJobsForDeal';
import { CommentsPanel } from './CommentsPanel';
import { useDealCommentUnread } from './hooks/useDealCommentUnread';
import { CHANNEL_LABEL, CHANNEL_THREAD, dealChannelTabs, type ChannelTab } from './commentChannels';

/** The deal page's Comments panel, tabbed per channel. Tabs appear only when
 *  the deal has matching jobs; a deal with none looks exactly like before.
 *  An inactive tab shows an amber dot when its thread has comments this user
 *  hasn't seen (own comments never count); viewing a tab marks it seen via
 *  CommentsPanel's useMarkThreadSeen. */
export function DealCommentsTabs({ dealId }: { dealId: string }) {
  const { data: jobs = [] } = useJobsForDeal(dealId);
  const tabs = dealChannelTabs(jobs);
  const { data: unread } = useDealCommentUnread(dealId, tabs);
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
            {CHANNEL_LABEL[tab]}
            {tab !== current && unread?.[tab] && (
              <span
                aria-label="new comments"
                className="ml-1.5 inline-block size-1.5 shrink-0 rounded-full bg-amber-500"
              />
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab}
          value={tab}
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
        >
          <CommentsPanel parentType={CHANNEL_THREAD[tab]} parentId={dealId} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
