import { describe, expect, it } from 'vitest';
import { filterAssignableOwners } from './assignableOwners';
import type { MentionableUser } from '@/features/comments/hooks/useMentionableUsers';

function user(
  user_id: string,
  group_codes: string[],
  is_admin = false,
): MentionableUser {
  return { user_id, full_name: user_id, email: `${user_id}@itdev.gr`, is_admin, group_codes };
}

const admin = user('admin', ['sales'], true);
const webdev = user('webdev', ['web_dev']);
const localSeo = user('local-seo', ['local_seo']);
const webSeo = user('web-seo', ['web_seo']);
const salesRep = user('sales-rep', ['sales']);
const all = [admin, webdev, localSeo, webSeo, salesRep];

describe('filterAssignableOwners', () => {
  it('keeps only department members and admins for web_dev', () => {
    const r = filterAssignableOwners(all, 'web_dev', null);
    expect(r.map((o) => o.user_id)).toEqual(['admin', 'webdev']);
  });

  it('keeps a current owner who is outside the department', () => {
    const r = filterAssignableOwners(all, 'web_dev', 'sales-rep');
    expect(r.map((o) => o.user_id)).toEqual(['admin', 'webdev', 'sales-rep']);
  });

  it('accepts ai_seo, local_seo and web_seo members for ai_seo jobs', () => {
    const r = filterAssignableOwners(all, 'ai_seo', null);
    expect(r.map((o) => o.user_id)).toEqual(['admin', 'local-seo', 'web-seo']);
  });

  it('falls back to the full list when the department has no members', () => {
    const r = filterAssignableOwners(all, 'hosting', null);
    expect(r).toEqual(all);
  });

  it('does not duplicate a current owner who is also a department member', () => {
    const r = filterAssignableOwners(all, 'web_dev', 'webdev');
    expect(r.map((o) => o.user_id)).toEqual(['admin', 'webdev']);
  });

  it('preserves the input ordering', () => {
    const reordered = [salesRep, webSeo, localSeo, webdev, admin];
    const r = filterAssignableOwners(reordered, 'local_seo', null);
    expect(r.map((o) => o.user_id)).toEqual(['local-seo', 'admin']);
  });

  it('tolerates missing group_codes', () => {
    const noGroups = { ...user('no-groups', []), group_codes: undefined as unknown as string[] };
    const r = filterAssignableOwners([noGroups, webdev], 'web_dev', null);
    expect(r.map((o) => o.user_id)).toEqual(['webdev']);
  });
});
