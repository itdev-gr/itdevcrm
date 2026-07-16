import { beforeEach, describe, it, expect } from 'vitest';
import {
  useCommentDraftStore,
  commentThreadKey,
  taskThreadKey,
  clearAllDrafts,
  DRAFT_TTL_MS,
} from './commentDraftStore';

describe('commentDraftStore', () => {
  beforeEach(() => {
    useCommentDraftStore.setState({ drafts: {} });
    window.localStorage.clear();
  });

  it('returns empty string when no draft is stored', () => {
    expect(useCommentDraftStore.getState().getDraft('comment:deal:d1')).toBe('');
  });

  it('stores and reads a draft under its key', () => {
    useCommentDraftStore.getState().setDraft('comment:deal:d1', 'hello');
    expect(useCommentDraftStore.getState().getDraft('comment:deal:d1')).toBe('hello');
  });

  it('deletes the key when set to empty or whitespace-only', () => {
    const s = useCommentDraftStore.getState();
    s.setDraft('comment:deal:d1', 'hi');
    s.setDraft('comment:deal:d1', '   ');
    expect(useCommentDraftStore.getState().getDraft('comment:deal:d1')).toBe('');
    expect('comment:deal:d1' in useCommentDraftStore.getState().drafts).toBe(false);
  });

  it('clearDraft removes the key', () => {
    const s = useCommentDraftStore.getState();
    s.setDraft('task:assigned:t1', 'draft');
    s.clearDraft('task:assigned:t1');
    expect(useCommentDraftStore.getState().getDraft('task:assigned:t1')).toBe('');
  });

  it('keeps independent drafts per key', () => {
    const s = useCommentDraftStore.getState();
    s.setDraft('comment:deal:d1', 'A');
    s.setDraft('comment:deal:d1:reply:c9', 'B');
    s.setDraft('task:user:t2', 'C');
    const st = useCommentDraftStore.getState();
    expect(st.getDraft('comment:deal:d1')).toBe('A');
    expect(st.getDraft('comment:deal:d1:reply:c9')).toBe('B');
    expect(st.getDraft('task:user:t2')).toBe('C');
  });

  it('persists drafts under itdevcrm-comment-drafts-v1', () => {
    useCommentDraftStore.getState().setDraft('comment:deal:d1', 'saved');
    const raw = window.localStorage.getItem('itdevcrm-comment-drafts-v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.drafts['comment:deal:d1'].text).toBe('saved');
  });

  it('pruneOldDrafts drops entries older than the TTL and keeps fresh ones', () => {
    const now = 1_000_000_000_000;
    useCommentDraftStore.setState({
      drafts: {
        old: { text: 'stale', savedAt: now - DRAFT_TTL_MS - 1 },
        fresh: { text: 'keep', savedAt: now - 1000 },
      },
    });
    useCommentDraftStore.getState().pruneOldDrafts(now);
    const d = useCommentDraftStore.getState().drafts;
    expect('old' in d).toBe(false);
    expect(d.fresh?.text).toBe('keep');
  });

  it('clearAllDrafts wipes every draft and its localStorage blob but spares unrelated keys', () => {
    const s = useCommentDraftStore.getState();
    s.setDraft('comment:deal:d1', 'A');
    s.setDraft('task:assigned:t1', 'B');
    // An unrelated app key on the same device must survive a logout wipe.
    window.localStorage.setItem('itdevcrm-theme', 'dark');
    expect(window.localStorage.getItem('itdevcrm-comment-drafts-v1')).toBeTruthy();

    clearAllDrafts();

    expect(useCommentDraftStore.getState().drafts).toEqual({});
    expect(useCommentDraftStore.getState().getDraft('comment:deal:d1')).toBe('');
    expect(window.localStorage.getItem('itdevcrm-comment-drafts-v1')).toBeNull();
    expect(window.localStorage.getItem('itdevcrm-theme')).toBe('dark');
  });

  it('builds thread keys', () => {
    expect(commentThreadKey('deal', 'd1')).toBe('comment:deal:d1');
    expect(commentThreadKey('deal', 'd1', 'c9')).toBe('comment:deal:d1:reply:c9');
    expect(taskThreadKey('assigned', 't1')).toBe('task:assigned:t1');
  });
});
