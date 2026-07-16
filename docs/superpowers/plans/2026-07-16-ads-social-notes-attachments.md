# Ads + Social Service Attachments & Social Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ads and social_media services the same deal-page Notes + Service-attachments functionality that Dev/SEO have: a `social_notes` Info field (ads notes already exist) and `svc_ads`/`svc_social` attachment areas with department-gated RLS.

**Architecture:** Pure pattern extension. One migration recreates the two `attachments` RLS policies with two new kind→group branches. Frontend adds one Info-field entry (`social_media`) and two `ServiceArea` entries — every consumer (job Info tab, deal Service info card, deal Service attachments card, upload gating) iterates the shared registries, so no other code changes.

**Tech Stack:** React + TypeScript, vitest, Supabase Postgres RLS (project `xujlrclyzxrvxszepquy`).

**Spec:** `docs/superpowers/specs/2026-07-16-ads-social-notes-attachments-design.md`

## Global Constraints

- Commit directly to `main` after each task — NO pull requests. `git pull --rebase origin main` before any push (the owner commits in parallel).
- `npm run build` = `tsc -b && eslint (max-warnings=0) && vite build` — must pass clean.
- NEVER run the full vitest suite (some integration tests hit PROD). Run ONLY the test files named in each step.
- Prod Supabase project id: `xujlrclyzxrvxszepquy`. The migration (Task 1) is applied by the CONTROLLER session, not by implementer subagents.
- NO types regen needed: this migration touches only RLS policies — no new tables/columns/RPCs, so `src/types/supabase.ts` is unaffected (unlike the comment_thread_reads migration earlier today).
- Live policy expressions of `attachments_insert`/`attachments_delete` were verified on 2026-07-16 to match `20260624140000_service_attachment_rls.sql` exactly (no drift).
- Labels are bilingual via the existing `labelEn`/`labelEl` fields — values below are exact; do not invent i18n keys.

---

### Task 1: DB migration — svc_ads / svc_social RLS branches

**Files:**
- Create: `supabase/migrations/20260716150000_ads_social_service_attachment_rls.sql`

**Interfaces:**
- Consumes: existing `public.current_user_in_group(text)` and `public.current_user_is_admin()` (already granted).
- Produces: `attachments` rows with `kind='svc_ads'` writable only by admins + `ads` group; `kind='svc_social'` only by admins + `social_media` group. Frontend tasks rely on exactly the kind strings `svc_ads` / `svc_social`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260716150000_ads_social_service_attachment_rls.sql` with exactly:

```sql
-- =============================================================================
-- Service attachments for Ads + Social: extend the svc_* RLS gating
-- (20260624140000) with kind 'svc_ads' -> ads group and
-- kind 'svc_social' -> social_media group. Both kinds are added to the
-- gated-kinds list so non-department staff cannot write them.
-- attachments.kind has no CHECK constraint — policies are the only DB surface.
--
-- ROLLBACK (manual): re-run the two policy definitions from
-- 20260624140000_service_attachment_rls.sql (verified identical to live
-- pre-change on 2026-07-16). Any svc_ads/svc_social rows keep existing but
-- stop being uploadable.
-- =============================================================================

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert with check (
    auth.uid() = uploaded_by
    and (
      kind is null
      or kind not in ('svc_local','svc_web','svc_webdev','svc_ads','svc_social')
      or public.current_user_is_admin()
      or (kind = 'svc_local'  and public.current_user_in_group('local_seo'))
      or (kind = 'svc_web'    and public.current_user_in_group('web_seo'))
      or (kind = 'svc_webdev' and public.current_user_in_group('web_dev'))
      or (kind = 'svc_ads'    and public.current_user_in_group('ads'))
      or (kind = 'svc_social' and public.current_user_in_group('social_media'))
    )
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete using (
    public.current_user_is_admin()
    or auth.uid() = uploaded_by
    or (kind = 'svc_local'  and public.current_user_in_group('local_seo'))
    or (kind = 'svc_web'    and public.current_user_in_group('web_seo'))
    or (kind = 'svc_webdev' and public.current_user_in_group('web_dev'))
    or (kind = 'svc_ads'    and public.current_user_in_group('ads'))
    or (kind = 'svc_social' and public.current_user_in_group('social_media'))
  );

-- Post-asserts — fail loudly if anything is off.
do $$
declare ins text; del text;
begin
  select pg_get_expr(polwithcheck, polrelid) into ins from pg_policy
    where polrelid = 'public.attachments'::regclass and polname = 'attachments_insert';
  select pg_get_expr(polqual, polrelid) into del from pg_policy
    where polrelid = 'public.attachments'::regclass and polname = 'attachments_delete';
  if ins is null or ins not like '%svc_ads%' or ins not like '%svc_social%' then
    raise exception 'attachments_insert missing svc_ads/svc_social';
  end if;
  if del is null or del not like '%svc_ads%' or del not like '%svc_social%' then
    raise exception 'attachments_delete missing svc_ads/svc_social';
  end if;
end $$;
```

- [ ] **Step 2: Apply to prod (CONTROLLER session only)**

Via `mcp__plugin_supabase_supabase__apply_migration` with `project_id: "xujlrclyzxrvxszepquy"`, `name: "ads_social_service_attachment_rls"`, and the file's SQL. Success = post-asserts passed. Implementer subagents: skip this step and hand back.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716150000_ads_social_service_attachment_rls.sql
git commit -m "feat(attachments): svc_ads/svc_social RLS gating (ads + social_media groups)"
```

---

### Task 2: Social notes Info field

**Files:**
- Modify: `src/features/jobs/serviceInfoFields.ts` (add SOCIAL const + map entry + type key)
- Modify: `src/features/jobs/serviceInfoFields.test.ts`
- Modify: `src/features/deals/DealServiceInfo.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks (independent of Task 1/3).
- Produces: `infoFieldsFor('social_media')` returns `[{ key: 'social_notes', … }]`; `sharedDealFields('social_media', details)` surfaces filled notes. Job Info tab and deal Service info card light up automatically.

- [ ] **Step 1: Update the failing tests**

In `src/features/jobs/serviceInfoFields.test.ts`, REPLACE this existing test (social_media now has fields):

```ts
  it('returns [] for a service without an Info tab', () => {
    expect(infoFieldsFor('social_media')).toEqual([]);
  });
```

with:

```ts
  it('social_media has a single notes field shared with the deal', () => {
    const fields = infoFieldsFor('social_media');
    expect(fields.map((f) => f.key)).toEqual(['social_notes']);
    expect(fields[0]?.type).toBe('textarea');
    expect(fields[0]?.sharedWithDeal).toBe(true);
  });
  it('returns [] for a service without an Info tab', () => {
    expect(infoFieldsFor('hosting')).toEqual([]);
  });
```

In the `describe('sharedDealFields', …)` block, after the ads test add:

```ts
  it('flows social notes through to the deal', () => {
    expect(sharedDealFields('social_media', { social_notes: 'reels scheduled' }).map((f) => f.key)).toEqual([
      'social_notes',
    ]);
  });
```

In `src/features/deals/DealServiceInfo.test.tsx`, extend the `useDealJobs` mock's `data` array with a second job (after the web_seo one):

```ts
      {
        id: 'j2', service_type: 'social_media',
        details: { social_notes: 'reels scheduled' },
      },
```

and add a second test inside the describe block:

```ts
  it('shows social media notes shared from a social job', () => {
    render(<DealServiceInfo dealId="d1" />);
    expect(screen.getByText('reels scheduled')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts src/features/deals/DealServiceInfo.test.tsx`
Expected: FAIL — social_media returns `[]`, 'reels scheduled' not rendered.

- [ ] **Step 3: Implement**

In `src/features/jobs/serviceInfoFields.ts`, directly after the `ADS` const:

```ts
const SOCIAL: InfoField[] = [
  { key: 'social_notes', labelEn: 'Social Media Notes', labelEl: 'Σημειώσεις Social Media', type: 'textarea', sharedWithDeal: true },
];
```

Extend the `SERVICE_INFO_FIELDS` declaration — the type annotation gains `social_media: InfoField[];` after `ads: InfoField[];`, and the object gains `social_media: SOCIAL,` after `ads: ADS,`:

```ts
export const SERVICE_INFO_FIELDS: Record<string, InfoField[] | undefined> & {
  local_seo: InfoField[];
  web_seo: InfoField[];
  ai_seo: InfoField[];
  web_dev: InfoField[];
  ads: InfoField[];
  social_media: InfoField[];
} = {
  local_seo: LOCAL,
  web_seo: WEB_SEO,
  ai_seo: [...withSection(LOCAL, 'Local SEO'), ...withSection(WEB_SEO, 'Web SEO')],
  web_dev: WEB_DEV,
  ads: ADS,
  social_media: SOCIAL,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts src/features/deals/DealServiceInfo.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/serviceInfoFields.ts src/features/jobs/serviceInfoFields.test.ts src/features/deals/DealServiceInfo.test.tsx
git commit -m "feat(jobs): Social Media Notes info field (job Info tab + shared to deal)"
```

---

### Task 3: svc_ads / svc_social areas + final verification

**Files:**
- Modify: `src/features/attachments/serviceAreas.ts` (full rewrite below)
- Modify: `src/features/attachments/serviceAreas.test.ts` (full rewrite below)

**Interfaces:**
- Consumes: kind strings `svc_ads`/`svc_social` gated by Task 1's policies; groups `ads`/`social_media` (exist in prod).
- Produces: `ADS_AREA`/`SOCIAL_AREA` exported; `SERVICE_AREA_KINDS` has 5 kinds — `DealServiceAttachments`, `useDealServiceAttachments`, and `JobDetailPage`'s `areasForJob(...)` upload sections pick them up with no changes.

- [ ] **Step 1: Write the failing tests**

Replace `src/features/attachments/serviceAreas.test.ts` entirely with:

```ts
import { describe, it, expect } from 'vitest';
import {
  areasForJob,
  areaForKind,
  canUploadArea,
  LOCAL_AREA,
  WEB_AREA,
  WEBDEV_AREA,
  ADS_AREA,
  SOCIAL_AREA,
} from './serviceAreas';

describe('areasForJob', () => {
  it('ai_seo parent → no area (files live on its children)', () => {
    expect(areasForJob({ service_type: 'ai_seo' })).toEqual([]);
  });
  it('local_seo (standalone or AI SEO child) → Local', () => {
    expect(areasForJob({ service_type: 'local_seo' })).toEqual([LOCAL_AREA]);
  });
  it('web_seo (standalone or AI SEO child) → Web', () => {
    expect(areasForJob({ service_type: 'web_seo' })).toEqual([WEB_AREA]);
  });
  it('web_dev → Web Dev', () => {
    expect(areasForJob({ service_type: 'web_dev' })).toEqual([WEBDEV_AREA]);
  });
  it('ads → Ads', () => {
    expect(areasForJob({ service_type: 'ads' })).toEqual([ADS_AREA]);
  });
  it('social_media → Social Media', () => {
    expect(areasForJob({ service_type: 'social_media' })).toEqual([SOCIAL_AREA]);
  });
  it('other service → no areas', () => {
    expect(areasForJob({ service_type: 'hosting' })).toEqual([]);
  });
});

describe('areaForKind', () => {
  it('resolves the ads/social kinds', () => {
    expect(areaForKind('svc_ads')).toBe(ADS_AREA);
    expect(areaForKind('svc_social')).toBe(SOCIAL_AREA);
  });
  it('non-service kind → null', () => {
    expect(areaForKind('contract')).toBeNull();
  });
});

describe('canUploadArea', () => {
  it('admin can upload any area', () => {
    expect(canUploadArea(true, [], ADS_AREA)).toBe(true);
  });
  it('member of the area group can upload', () => {
    expect(canUploadArea(false, ['local_seo'], LOCAL_AREA)).toBe(true);
    expect(canUploadArea(false, ['ads'], ADS_AREA)).toBe(true);
    expect(canUploadArea(false, ['social_media'], SOCIAL_AREA)).toBe(true);
  });
  it('non-member cannot', () => {
    expect(canUploadArea(false, ['web_seo'], LOCAL_AREA)).toBe(false);
    expect(canUploadArea(false, ['web_seo'], ADS_AREA)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/features/attachments/serviceAreas.test.ts`
Expected: FAIL — `ADS_AREA`/`SOCIAL_AREA` not exported.

- [ ] **Step 3: Implement**

Replace `src/features/attachments/serviceAreas.ts` entirely with:

```ts
export type AreaKind = 'svc_local' | 'svc_web' | 'svc_webdev' | 'svc_ads' | 'svc_social';
export type AreaGroup = 'local_seo' | 'web_seo' | 'web_dev' | 'ads' | 'social_media';

export type ServiceArea = {
  kind: AreaKind;
  labelEn: string;
  labelEl: string;
  groupCode: AreaGroup;
};

export const LOCAL_AREA: ServiceArea = { kind: 'svc_local', labelEn: 'Local SEO', labelEl: 'Local SEO', groupCode: 'local_seo' };
export const WEB_AREA: ServiceArea = { kind: 'svc_web', labelEn: 'Web SEO', labelEl: 'Web SEO', groupCode: 'web_seo' };
export const WEBDEV_AREA: ServiceArea = { kind: 'svc_webdev', labelEn: 'Web Dev', labelEl: 'Web Dev', groupCode: 'web_dev' };
export const ADS_AREA: ServiceArea = { kind: 'svc_ads', labelEn: 'Ads', labelEl: 'Ads', groupCode: 'ads' };
export const SOCIAL_AREA: ServiceArea = { kind: 'svc_social', labelEn: 'Social Media', labelEl: 'Social Media', groupCode: 'social_media' };

export const SERVICE_AREA_KINDS: AreaKind[] = ['svc_local', 'svc_web', 'svc_webdev', 'svc_ads', 'svc_social'];
const BY_KIND: Record<AreaKind, ServiceArea> = {
  svc_local: LOCAL_AREA,
  svc_web: WEB_AREA,
  svc_webdev: WEBDEV_AREA,
  svc_ads: ADS_AREA,
  svc_social: SOCIAL_AREA,
};

export function areaForKind(kind: string): ServiceArea | null {
  return (SERVICE_AREA_KINDS as string[]).includes(kind) ? BY_KIND[kind as AreaKind] : null;
}

export function areasForJob(job: { service_type: string }): ServiceArea[] {
  switch (job.service_type) {
    case 'local_seo':
      return [LOCAL_AREA];
    case 'web_seo':
      return [WEB_AREA];
    case 'web_dev':
      return [WEBDEV_AREA];
    case 'ads':
      return [ADS_AREA];
    case 'social_media':
      return [SOCIAL_AREA];
    default:
      // The ai_seo PARENT shows no area — its Local/Web files live on the
      // local_seo / web_seo CHILD jobs (parent_job_id set), which the Local/Web
      // teams actually open from their boards. Those children match the cases
      // above by service_type, so they get their area automatically.
      return [];
  }
}

export function canUploadArea(isAdmin: boolean, groupCodes: string[], area: ServiceArea): boolean {
  return isAdmin || groupCodes.includes(area.groupCode);
}
```

- [ ] **Step 4: Run tests + regressions + strict build**

Run: `npx vitest run src/features/attachments src/features/jobs/serviceInfoFields.test.ts src/features/deals/DealServiceInfo.test.tsx`
Expected: PASS (all — includes CombinedAttachmentsTab regression).

Run: `npm run build`
Expected: exit 0 (tsc -b + eslint zero warnings + vite build). If tsc flags an exhaustive `AreaKind`/`AreaGroup` switch or map in a file this plan didn't touch, extend it with the new members (no casts) and report it as a concern.

- [ ] **Step 5: Commit**

```bash
git add src/features/attachments/serviceAreas.ts src/features/attachments/serviceAreas.test.ts
git commit -m "feat(attachments): Ads + Social service areas (svc_ads/svc_social)"
```

- [ ] **Step 6: Push (CONTROLLER session, after final review)**

```bash
git pull --rebase origin main
git push origin main
```

Post-deploy smoke (controller): as admin upload a file in an ads job's Info tab → appears on the deal's Service attachments card under "Ads"; type social notes on a social job → appears on the deal's Service info card.
