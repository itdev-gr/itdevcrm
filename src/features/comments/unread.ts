import { CHANNEL_THREAD, type ChannelTab } from './commentChannels';

export type LatestComment = { author_id: string; created_at: string };
export type ThreadReadRow = { parent_type: string; last_seen_at: string };

/** A tab is unread when its newest comment exists, wasn't written by me, and
 *  is newer than my last_seen_at for that thread (no row = never seen). */
export function deriveUnread(
  tabs: ChannelTab[],
  latestByTab: Partial<Record<ChannelTab, LatestComment | null>>,
  readRows: ThreadReadRow[],
  myId: string | null,
): Partial<Record<ChannelTab, boolean>> {
  const lastSeen = new Map(readRows.map((r) => [r.parent_type, Date.parse(r.last_seen_at)]));
  const unread: Partial<Record<ChannelTab, boolean>> = {};
  for (const tab of tabs) {
    const latest = latestByTab[tab];
    if (!latest || latest.author_id === myId) {
      unread[tab] = false;
      continue;
    }
    const seen = lastSeen.get(CHANNEL_THREAD[tab]);
    unread[tab] = seen === undefined || Date.parse(latest.created_at) > seen;
  }
  return unread;
}
