import { describe, it, expect } from 'vitest';
import { jobCommentThread, dealChannelTabs } from './commentChannels';

const job = (service_type: string) => ({ id: 'J1', deal_id: 'D1', service_type });

describe('jobCommentThread', () => {
  it('web_dev job -> the deal dev channel', () =>
    expect(jobCommentThread(job('web_dev'))).toEqual({ parentType: 'deal_dev', parentId: 'D1' }));
  it('web_seo / local_seo / ai_seo jobs -> the deal seo channel', () => {
    expect(jobCommentThread(job('web_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
    expect(jobCommentThread(job('local_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
    expect(jobCommentThread(job('ai_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
  });
  it('other services keep their private job thread', () => {
    expect(jobCommentThread(job('hosting'))).toEqual({ parentType: 'job', parentId: 'J1' });
    expect(jobCommentThread(job('ads'))).toEqual({ parentType: 'job', parentId: 'J1' });
    expect(jobCommentThread(job('social_media'))).toEqual({ parentType: 'job', parentId: 'J1' });
  });
});

describe('dealChannelTabs', () => {
  it('no dev/seo jobs -> general only', () =>
    expect(dealChannelTabs([job('hosting')])).toEqual(['general']));
  it('web_dev job -> +dev', () =>
    expect(dealChannelTabs([job('web_dev')])).toEqual(['general', 'dev']));
  it('any seo service -> +seo', () => {
    expect(dealChannelTabs([job('web_seo')])).toEqual(['general', 'seo']);
    expect(dealChannelTabs([job('local_seo')])).toEqual(['general', 'seo']);
    expect(dealChannelTabs([job('ai_seo')])).toEqual(['general', 'seo']);
  });
  it('both -> all three, stable order', () =>
    expect(dealChannelTabs([job('local_seo'), job('web_dev')])).toEqual(['general', 'dev', 'seo']));
  it('empty -> general only', () => expect(dealChannelTabs([])).toEqual(['general']));
});
