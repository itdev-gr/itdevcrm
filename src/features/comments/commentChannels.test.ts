import { describe, it, expect } from 'vitest';
import {
  jobCommentThread,
  dealChannelTabs,
  channelLabelFor,
  CHANNEL_THREAD,
  CHANNEL_LABEL,
} from './commentChannels';

const job = (service_type: string) => ({ id: 'J1', deal_id: 'D1', service_type });

describe('jobCommentThread', () => {
  it('web_dev job -> the deal dev channel', () =>
    expect(jobCommentThread(job('web_dev'))).toEqual({ parentType: 'deal_dev', parentId: 'D1' }));
  it('web_seo / local_seo / ai_seo jobs -> the deal seo channel', () => {
    expect(jobCommentThread(job('web_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
    expect(jobCommentThread(job('local_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
    expect(jobCommentThread(job('ai_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
  });
  it('ads job -> the deal ads channel', () =>
    expect(jobCommentThread(job('ads'))).toEqual({ parentType: 'deal_ads', parentId: 'D1' }));
  it('social_media job -> the deal social channel', () =>
    expect(jobCommentThread(job('social_media'))).toEqual({
      parentType: 'deal_social',
      parentId: 'D1',
    }));
  it('other services keep their private job thread', () => {
    expect(jobCommentThread(job('hosting'))).toEqual({ parentType: 'job', parentId: 'J1' });
    expect(jobCommentThread(job('domains'))).toEqual({ parentType: 'job', parentId: 'J1' });
  });
});

describe('dealChannelTabs', () => {
  it('no channel jobs -> general only', () =>
    expect(dealChannelTabs([job('hosting')])).toEqual(['general']));
  it('web_dev job -> +dev', () =>
    expect(dealChannelTabs([job('web_dev')])).toEqual(['general', 'dev']));
  it('any seo service -> +seo', () => {
    expect(dealChannelTabs([job('web_seo')])).toEqual(['general', 'seo']);
    expect(dealChannelTabs([job('local_seo')])).toEqual(['general', 'seo']);
    expect(dealChannelTabs([job('ai_seo')])).toEqual(['general', 'seo']);
  });
  it('ads job -> +ads', () => expect(dealChannelTabs([job('ads')])).toEqual(['general', 'ads']));
  it('social_media job -> +social', () =>
    expect(dealChannelTabs([job('social_media')])).toEqual(['general', 'social']));
  it('all services -> all five tabs, stable order', () =>
    expect(
      dealChannelTabs([job('social_media'), job('ads'), job('local_seo'), job('web_dev')]),
    ).toEqual(['general', 'dev', 'seo', 'ads', 'social']));
  it('empty -> general only', () => expect(dealChannelTabs([])).toEqual(['general']));
});

describe('channel maps', () => {
  it('CHANNEL_THREAD maps every tab to its parent_type', () => {
    expect(CHANNEL_THREAD).toEqual({
      general: 'deal',
      dev: 'deal_dev',
      seo: 'deal_seo',
      ads: 'deal_ads',
      social: 'deal_social',
    });
  });
  it('CHANNEL_LABEL covers every tab', () => {
    expect(CHANNEL_LABEL).toEqual({
      general: 'General',
      dev: 'Dev',
      seo: 'SEO',
      ads: 'Ads',
      social: 'Social',
    });
  });
  it('channelLabelFor labels channel parent types and rejects the rest', () => {
    expect(channelLabelFor('deal_dev')).toBe('Dev');
    expect(channelLabelFor('deal_seo')).toBe('SEO');
    expect(channelLabelFor('deal_ads')).toBe('Ads');
    expect(channelLabelFor('deal_social')).toBe('Social');
    expect(channelLabelFor('deal')).toBeNull();
    expect(channelLabelFor('job')).toBeNull();
  });
});
