# Per-Service Job Attachments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a group-gated Attachments area to the Info tab of `web_dev`/`local_seo`/`web_seo`/`ai_seo` jobs (AI SEO split Local+Web on the one job), with read-only download links surfaced on the deal for accounting.

**Architecture:** Reuse the `attachments` table tagged by `kind` (`svc_local`/`svc_web`/`svc_webdev`). A pure `areasForJob` decides which areas a job shows; RLS tightens `svc_*` upload/delete to the owning group (`current_user_in_group` helper); a gated `ServiceAttachmentsSection` renders each area in the Info tab; a read-only `DealServiceAttachments` surfaces them on the deal.

**Tech Stack:** React + Vite + TS, @tanstack/react-query, react-i18next, Supabase Postgres + Storage, Vitest, Playwright. Spec: `docs/superpowers/specs/2026-06-24-service-attachments-design.md`.

**Prod DB apply note:** Apply migration files to prod (`xujlrclyzxrvxszepquy`) via Supabase MCP `apply_migration`; verify with `execute_sql`.

---

## File Structure

**Create:**
- `supabase/migrations/20260624140000_service_attachment_rls.sql` — `current_user_in_group` + tightened attachments INSERT/DELETE.
- `src/features/attachments/serviceAreas.ts` (+ `.test.ts`) — area constants, `areasForJob`, `canUploadArea`.
- `src/features/attachments/ServiceAttachmentsSection.tsx` — per-area list + gated upload/delete.
- `src/features/deals/DealServiceAttachments.tsx` + `src/features/deals/hooks/useDealServiceAttachments.ts` — read-only deal view.

**Modify:**
- `src/features/attachments/hooks/useUploadAttachment.ts` — widen `kind` union.
- `src/features/attachments/AttachmentsPanel.tsx` — optional `hideKinds` filter.
- `src/features/jobs/JobDetailPage.tsx` — render areas in the Info tab + pass `hideKinds` to the generic Attachments tab.
- `src/features/deals/DealDetailPage.tsx` — render `DealServiceAttachments`.
- `src/i18n/locales/en/jobs.json` + `src/i18n/locales/el/jobs.json` — attachment strings.

---

## Task 1: RLS migration

**Files:** Create `supabase/migrations/20260624140000_service_attachment_rls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Service attachments: gate svc_* attachment writes to the owning group.
-- kind 'svc_local' -> local_seo group, 'svc_web' -> web_seo, 'svc_webdev' -> web_dev.
-- Non-service attachments (contract/invoice/other) keep the prior open behavior.
-- =============================================================================
create or replace function public.current_user_in_group(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_groups ug
    join public.groups g on g.id = ug.group_id
    where g.code = p_code and ug.user_id = auth.uid()
  );
$$;
grant execute on function public.current_user_in_group(text) to authenticated;

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert with check (
    auth.uid() = uploaded_by
    and (
      kind is null
      or kind not in ('svc_local','svc_web','svc_webdev')
      or public.current_user_is_admin()
      or (kind = 'svc_local'  and public.current_user_in_group('local_seo'))
      or (kind = 'svc_web'    and public.current_user_in_group('web_seo'))
      or (kind = 'svc_webdev' and public.current_user_in_group('web_dev'))
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
  );

-- Rollback:
-- drop policy if exists attachments_insert on public.attachments;
-- create policy attachments_insert on public.attachments
--   for insert with check (auth.uid() = uploaded_by);
-- drop policy if exists attachments_delete on public.attachments;
-- create policy attachments_delete on public.attachments
--   for delete using ((auth.uid() = uploaded_by) or current_user_is_admin());
-- drop function if exists public.current_user_in_group(text);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260624140000_service_attachment_rls.sql
git commit -m "feat(attachments): RLS gate svc_* writes to owning group"
```

---

## Task 2: Apply to prod + verify RLS

**Files:** none (Supabase MCP).

- [ ] **Step 1:** `apply_migration` name `service_attachment_rls` with the Task 1 SQL.
- [ ] **Step 2: RLS verification (role-switch, rolled back).** Run via `execute_sql`:

```sql
do $$
declare
  local_uid uuid; web_uid uuid; acct_uid uuid; admin_uid uuid; jid uuid;
  r jsonb := '{}'::jsonb;
  function_ok boolean;
begin
  select ug.user_id into local_uid from public.user_groups ug join public.groups g on g.id=ug.group_id
    join public.profiles p on p.user_id=ug.user_id where g.code='local_seo' and coalesce(p.is_admin,false)=false limit 1;
  select ug.user_id into web_uid from public.user_groups ug join public.groups g on g.id=ug.group_id
    join public.profiles p on p.user_id=ug.user_id where g.code='web_seo' and coalesce(p.is_admin,false)=false limit 1;
  select ug.user_id into acct_uid from public.user_groups ug join public.groups g on g.id=ug.group_id
    join public.profiles p on p.user_id=ug.user_id where g.code='accounting' and coalesce(p.is_admin,false)=false limit 1;
  select user_id into admin_uid from public.profiles where is_admin and is_active limit 1;
  select id into jid from public.jobs where service_type='ai_seo' and not archived limit 1;

  set local role authenticated;

  -- local member: svc_local should pass, svc_web should fail
  perform set_config('request.jwt.claims', json_build_object('sub', local_uid::text)::text, true);
  begin insert into public.attachments(parent_type,parent_id,storage_path,file_name,uploaded_by,kind)
    values('job',jid,'t/1','1',local_uid,'svc_local'); r := r || jsonb_build_object('local_svc_local','PASS');
  exception when others then r := r || jsonb_build_object('local_svc_local','FAIL'); end;
  begin insert into public.attachments(parent_type,parent_id,storage_path,file_name,uploaded_by,kind)
    values('job',jid,'t/2','2',local_uid,'svc_web'); r := r || jsonb_build_object('local_svc_web','PASS');
  exception when others then r := r || jsonb_build_object('local_svc_web','FAIL'); end;

  -- web member: svc_web pass, svc_local fail
  perform set_config('request.jwt.claims', json_build_object('sub', web_uid::text)::text, true);
  begin insert into public.attachments(parent_type,parent_id,storage_path,file_name,uploaded_by,kind)
    values('job',jid,'t/3','3',web_uid,'svc_web'); r := r || jsonb_build_object('web_svc_web','PASS');
  exception when others then r := r || jsonb_build_object('web_svc_web','FAIL'); end;
  begin insert into public.attachments(parent_type,parent_id,storage_path,file_name,uploaded_by,kind)
    values('job',jid,'t/4','4',web_uid,'svc_local'); r := r || jsonb_build_object('web_svc_local','PASS');
  exception when others then r := r || jsonb_build_object('web_svc_local','FAIL'); end;

  -- accounting member: svc_local fail (view only)
  perform set_config('request.jwt.claims', json_build_object('sub', acct_uid::text)::text, true);
  begin insert into public.attachments(parent_type,parent_id,storage_path,file_name,uploaded_by,kind)
    values('job',jid,'t/5','5',acct_uid,'svc_local'); r := r || jsonb_build_object('acct_svc_local','PASS');
  exception when others then r := r || jsonb_build_object('acct_svc_local','FAIL'); end;

  -- admin: svc_web pass (override)
  perform set_config('request.jwt.claims', json_build_object('sub', admin_uid::text)::text, true);
  begin insert into public.attachments(parent_type,parent_id,storage_path,file_name,uploaded_by,kind)
    values('job',jid,'t/6','6',admin_uid,'svc_web'); r := r || jsonb_build_object('admin_svc_web','PASS');
  exception when others then r := r || jsonb_build_object('admin_svc_web','FAIL'); end;

  raise exception 'RLS %', r;
end $$;
```
Expected: `local_svc_local=PASS, local_svc_web=FAIL, web_svc_web=PASS, web_svc_local=FAIL, acct_svc_local=FAIL, admin_svc_web=PASS`. The RAISE rolls everything back (no rows persist).

- [ ] **Step 3:** No commit (DB-only).

---

## Task 3: serviceAreas pure module (TDD)

**Files:** Create `src/features/attachments/serviceAreas.ts`, Test `src/features/attachments/serviceAreas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { areasForJob, canUploadArea, LOCAL_AREA, WEB_AREA, WEBDEV_AREA } from './serviceAreas';

describe('areasForJob', () => {
  it('ai_seo parent → Local + Web', () => {
    expect(areasForJob({ service_type: 'ai_seo', parent_job_id: null })).toEqual([LOCAL_AREA, WEB_AREA]);
  });
  it('local_seo → Local', () => {
    expect(areasForJob({ service_type: 'local_seo', parent_job_id: null })).toEqual([LOCAL_AREA]);
  });
  it('web_seo → Web', () => {
    expect(areasForJob({ service_type: 'web_seo', parent_job_id: null })).toEqual([WEB_AREA]);
  });
  it('web_dev → Web Dev', () => {
    expect(areasForJob({ service_type: 'web_dev', parent_job_id: null })).toEqual([WEBDEV_AREA]);
  });
  it('AI SEO child (has parent) → no areas', () => {
    expect(areasForJob({ service_type: 'local_seo', parent_job_id: 'p1' })).toEqual([]);
  });
  it('other service → no areas', () => {
    expect(areasForJob({ service_type: 'hosting', parent_job_id: null })).toEqual([]);
  });
});

describe('canUploadArea', () => {
  it('admin can upload any area', () => {
    expect(canUploadArea(true, [], LOCAL_AREA)).toBe(true);
  });
  it('member of the area group can upload', () => {
    expect(canUploadArea(false, ['local_seo'], LOCAL_AREA)).toBe(true);
  });
  it('non-member cannot', () => {
    expect(canUploadArea(false, ['web_seo'], LOCAL_AREA)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/attachments/serviceAreas.test.ts`
Expected: FAIL — cannot resolve `./serviceAreas`.

- [ ] **Step 3: Write the implementation**

```ts
export type AreaKind = 'svc_local' | 'svc_web' | 'svc_webdev';
export type AreaGroup = 'local_seo' | 'web_seo' | 'web_dev';

export type ServiceArea = {
  kind: AreaKind;
  labelEn: string;
  labelEl: string;
  groupCode: AreaGroup;
};

export const LOCAL_AREA: ServiceArea = { kind: 'svc_local', labelEn: 'Local SEO', labelEl: 'Local SEO', groupCode: 'local_seo' };
export const WEB_AREA: ServiceArea = { kind: 'svc_web', labelEn: 'Web SEO', labelEl: 'Web SEO', groupCode: 'web_seo' };
export const WEBDEV_AREA: ServiceArea = { kind: 'svc_webdev', labelEn: 'Web Dev', labelEl: 'Web Dev', groupCode: 'web_dev' };

export const SERVICE_AREA_KINDS: AreaKind[] = ['svc_local', 'svc_web', 'svc_webdev'];
const BY_KIND: Record<AreaKind, ServiceArea> = {
  svc_local: LOCAL_AREA,
  svc_web: WEB_AREA,
  svc_webdev: WEBDEV_AREA,
};

export function areaForKind(kind: string): ServiceArea | null {
  return (SERVICE_AREA_KINDS as string[]).includes(kind) ? BY_KIND[kind as AreaKind] : null;
}

export function areasForJob(job: { service_type: string; parent_job_id: string | null }): ServiceArea[] {
  if (job.parent_job_id != null) return [];
  switch (job.service_type) {
    case 'ai_seo':
      return [LOCAL_AREA, WEB_AREA];
    case 'local_seo':
      return [LOCAL_AREA];
    case 'web_seo':
      return [WEB_AREA];
    case 'web_dev':
      return [WEBDEV_AREA];
    default:
      return [];
  }
}

export function canUploadArea(isAdmin: boolean, groupCodes: string[], area: ServiceArea): boolean {
  return isAdmin || groupCodes.includes(area.groupCode);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/attachments/serviceAreas.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/attachments/serviceAreas.ts src/features/attachments/serviceAreas.test.ts
git commit -m "feat(attachments): serviceAreas (areasForJob + canUploadArea, tested)"
```

---

## Task 4: Widen useUploadAttachment kind

**Files:** Modify `src/features/attachments/hooks/useUploadAttachment.ts`

- [ ] **Step 1: Widen the `kind` union** — replace the `Vars` type's `kind` line:

```ts
  kind?: 'contract' | 'invoice' | 'other' | 'svc_local' | 'svc_web' | 'svc_webdev';
```

(The insert body `kind: vars.kind ?? 'other'` is unchanged.)

- [ ] **Step 2: Verify compile + commit**

Run: `npm run typecheck` → PASS.

```bash
git add src/features/attachments/hooks/useUploadAttachment.ts
git commit -m "feat(attachments): allow svc_* kinds in upload hook"
```

---

## Task 5: ServiceAttachmentsSection

**Files:** Create `src/features/attachments/ServiceAttachmentsSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAttachments } from './hooks/useAttachments';
import { useUploadAttachment } from './hooks/useUploadAttachment';
import { useDeleteAttachment } from './hooks/useDeleteAttachment';
import type { ServiceArea } from './serviceAreas';

export function ServiceAttachmentsSection({
  jobId,
  area,
  canUpload,
  lang,
}: {
  jobId: string;
  area: ServiceArea;
  canUpload: boolean;
  lang: 'en' | 'el';
}) {
  const { t } = useTranslation('jobs');
  const { data: all = [] } = useAttachments('job', jobId);
  const files = all.filter((a) => a.kind === area.kind);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  async function onUpload() {
    if (!file) return;
    try {
      await upload.mutateAsync({ parent_type: 'job', parent_id: jobId, file, kind: area.kind });
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function download(path: string) {
    const { data } = await supabase.storage.from('attachments').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  const label = lang === 'el' ? area.labelEl : area.labelEn;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <Paperclip className="size-3.5" /> {label} · {t('attachments.title')}
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('attachments.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                onClick={() => download(f.storage_path)}
                className="min-w-0 truncate text-left font-medium text-primary hover:underline"
              >
                {f.file_name}
              </button>
              {canUpload && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() =>
                    del.mutate({
                      id: f.id,
                      storage_path: f.storage_path,
                      parent_type: 'job',
                      parent_id: jobId,
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)}
            className="text-xs"
          />
          <Button size="sm" onClick={onUpload} disabled={!file || upload.isPending}>
            <Upload className="size-3.5" /> {t('attachments.upload')}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile + commit**

Run: `npm run typecheck` → PASS.

```bash
git add src/features/attachments/ServiceAttachmentsSection.tsx
git commit -m "feat(attachments): ServiceAttachmentsSection (gated per-area list)"
```

---

## Task 6: Render areas in the job Info tab

**Files:** Modify `src/features/jobs/JobDetailPage.tsx`

- [ ] **Step 1: Add imports** (after the existing imports):

```tsx
import { useAuthStore } from '@/lib/stores/authStore';
import { areasForJob, canUploadArea } from '@/features/attachments/serviceAreas';
import { ServiceAttachmentsSection } from '@/features/attachments/ServiceAttachmentsSection';
```

- [ ] **Step 2: Read auth state** — inside the component, near the other hooks (after `const { data: parentJob } = useJob(...)`):

```tsx
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
```

- [ ] **Step 3: Render the area sections in the Info tab** — replace the Info `TabsContent` body card:

```tsx
            <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
              <JobInfoPanel
                jobId={job.id}
                serviceType={job.service_type}
                initialDetails={(job.details ?? {}) as Record<string, unknown>}
              />
            </div>
```

with:

```tsx
            <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
              <JobInfoPanel
                jobId={job.id}
                serviceType={job.service_type}
                initialDetails={(job.details ?? {}) as Record<string, unknown>}
              />
              {areasForJob(job).map((area) => (
                <ServiceAttachmentsSection
                  key={area.kind}
                  jobId={job.id}
                  area={area}
                  canUpload={canUploadArea(isAdmin, groupCodes, area)}
                  lang={lang}
                />
              ))}
            </div>
```

- [ ] **Step 4: Hide svc_* from the generic Attachments tab** — change the Attachments `TabsContent`:

```tsx
            <AttachmentsPanel parentType="job" parentId={job.id} />
```

to:

```tsx
            <AttachmentsPanel
              parentType="job"
              parentId={job.id}
              hideKinds={['svc_local', 'svc_web', 'svc_webdev']}
            />
```

- [ ] **Step 5: Build + commit** (depends on Task 7's `hideKinds` prop — do Task 7 first, then build)

```bash
git add src/features/jobs/JobDetailPage.tsx
git commit -m "feat(attachments): show per-service attachment areas in job Info tab"
```

---

## Task 7: AttachmentsPanel hideKinds prop

**Files:** Modify `src/features/attachments/AttachmentsPanel.tsx`

- [ ] **Step 1: Add the optional prop** — change the `Props` type and `useAttachments` filtering:

Replace:

```tsx
type Props = {
  parentType: 'client' | 'deal' | 'job' | 'lead';
  parentId: string;
};

export function AttachmentsPanel({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: list = [] } = useAttachments(parentType, parentId);
```

with:

```tsx
type Props = {
  parentType: 'client' | 'deal' | 'job' | 'lead';
  parentId: string;
  hideKinds?: string[];
};

export function AttachmentsPanel({ parentType, parentId, hideKinds = [] }: Props) {
  const { t } = useTranslation('sales');
  const { data: rawList = [] } = useAttachments(parentType, parentId);
  const list = hideKinds.length ? rawList.filter((a) => !hideKinds.includes(a.kind ?? '')) : rawList;
```

- [ ] **Step 2: Build (strict)** — now both Task 6 and Task 7 compile together.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/attachments/AttachmentsPanel.tsx
git commit -m "feat(attachments): AttachmentsPanel hideKinds filter"
```

---

## Task 8: Deal read-only Service files

**Files:** Create `src/features/deals/hooks/useDealServiceAttachments.ts`, `src/features/deals/DealServiceAttachments.tsx`; Modify `src/features/deals/DealDetailPage.tsx`

- [ ] **Step 1: Create the hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useDealJobs } from './useDealJobs';
import { SERVICE_AREA_KINDS } from '@/features/attachments/serviceAreas';
import type { AttachmentRow } from '@/features/attachments/hooks/useAttachments';

export function useDealServiceAttachments(dealId: string) {
  const { data: jobs = [] } = useDealJobs(dealId);
  const jobIds = jobs.map((j) => j.id);
  return useQuery<AttachmentRow[]>({
    queryKey: ['deal-service-attachments', dealId, jobIds.join(',')],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attachments')
        .select('*')
        .eq('parent_type', 'job')
        .in('parent_id', jobIds)
        .in('kind', SERVICE_AREA_KINDS)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AttachmentRow[];
    },
  });
}
```

> Note: `useDealJobs` lives at `src/features/deals/hooks/useDealJobs.ts`; this hook is in the same folder, so the import is `./useDealJobs`.

- [ ] **Step 2: Create the read-only component**

```tsx
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDealServiceAttachments } from './hooks/useDealServiceAttachments';
import { areaForKind, SERVICE_AREA_KINDS } from '@/features/attachments/serviceAreas';

export function DealServiceAttachments({ dealId }: { dealId: string }) {
  const { t, i18n } = useTranslation('jobs');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: files = [] } = useDealServiceAttachments(dealId);
  if (files.length === 0) return null;

  async function download(path: string) {
    const { data } = await supabase.storage.from('attachments').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <Paperclip className="size-4" /> {t('attachments.deal_title')}
      </h2>
      <div className="space-y-3">
        {SERVICE_AREA_KINDS.map((kind) => {
          const area = areaForKind(kind);
          const group = files.filter((f) => f.kind === kind);
          if (!area || group.length === 0) return null;
          return (
            <div key={kind} className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {lang === 'el' ? area.labelEl : area.labelEn}
              </div>
              <ul className="space-y-1">
                {group.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => download(f.storage_path)}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {f.file_name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render on the deal page** — in `src/features/deals/DealDetailPage.tsx`, add the import and render it right after `<DealServiceInfo dealId={dealId} />`:

```tsx
import { DealServiceAttachments } from './DealServiceAttachments';
```

```tsx
              <DealServiceInfo dealId={dealId} />
              <DealServiceAttachments dealId={dealId} />
```

- [ ] **Step 4: Build + commit**

Run: `npm run build` → PASS.

```bash
git add src/features/deals/hooks/useDealServiceAttachments.ts src/features/deals/DealServiceAttachments.tsx src/features/deals/DealDetailPage.tsx
git commit -m "feat(attachments): read-only Service files on the deal (accounting)"
```

---

## Task 9: i18n

**Files:** Modify `src/i18n/locales/en/jobs.json`, `src/i18n/locales/el/jobs.json`

- [ ] **Step 1: Add an `attachments` block to `en/jobs.json`** (new top-level key, e.g. after `part_of_ai_seo`/`view_billing_record`):

```json
  "attachments": {
    "title": "Attachments",
    "empty": "No files yet.",
    "upload": "Upload",
    "deal_title": "Service files"
  },
```

- [ ] **Step 2: Add to `el/jobs.json`:**

```json
  "attachments": {
    "title": "Συνημμένα",
    "empty": "Δεν υπάρχουν αρχεία.",
    "upload": "Μεταφόρτωση",
    "deal_title": "Αρχεία υπηρεσιών"
  },
```

- [ ] **Step 3: Validate + commit**

Run: `node -e "['en','el'].forEach(l=>require('./src/i18n/locales/'+l+'/jobs.json'));console.log('json ok')"`
Expected: `json ok`.

```bash
git add src/i18n/locales/en/jobs.json src/i18n/locales/el/jobs.json
git commit -m "i18n(attachments): service-attachment strings (en + el)"
```

---

## Task 10: Build + test gate

- [ ] **Step 1:** `npm run build` → PASS (tsc -b + eslint --max-warnings=0 + vite).
- [ ] **Step 2:** `npm run test:run` → all pass (existing + new serviceAreas tests).
- [ ] **Step 3:** Push to `origin/main` (rebase first): `git fetch origin && git pull --rebase origin main && git push origin main`. Wait for the Vercel deploy (the live smoke needs the deployed UI).
- [ ] **Step 4:** No commit beyond the push.

---

## Task 11: Live smoke — REAL USER, per group (hard requirement)

Drive the **deployed UI as a real user** with Playwright (click, pick files, upload) — no SQL shortcuts for the behavior itself — to surface real product problems. Then delete every test attachment (Storage + row) and every test account.

- [ ] **Step 1: Create one test account per group.** Via `execute_sql`, for each of `local_seo`, `web_seo`, `web_dev`, `accounting`, insert an auth user + identity, set the profile active/non-admin with `must_change_password=false`, normalize the GoTrue token columns to `''`, and add the group membership. Use a fixed uuid + `test-<group>@example.com` + password `123456789`:

```sql
do $$
declare ids text[] := array['local_seo','web_seo','web_dev','accounting'];
  code text; uid uuid; gid uuid; em text;
begin
  foreach code in array ids loop
    uid := ('a77ac' || lpad((array_position(ids, code))::text, 3, '0') || '0000-0000-4000-8000-0000000000' || lpad((array_position(ids, code))::text,2,'0'))::uuid;
    em := 'test-' || code || '@example.com';
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated','authenticated', em,
      extensions.crypt('123456789', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('email_verified',true,'full_name','TEST '||code,'must_change_password',false),
      now(), now(), false, false, '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
    values (uid::text, uid, jsonb_build_object('sub',uid::text,'email',em,'email_verified',false,'phone_verified',false),
      'email', now(), now(), now(), gen_random_uuid());
    update public.profiles set full_name='TEST '||code, is_admin=false, is_active=true,
      must_change_password=false, archived=false, preferred_locale='en' where user_id=uid;
    select id into gid from public.groups where g_code_match(code);  -- replace with: where code = code
    insert into public.user_groups (user_id, group_id) values (uid, (select id from public.groups where code = code)) on conflict do nothing;
  end loop;
end $$;
select u.email, p.is_admin, p.is_active, g.code as grp
from auth.users u join public.profiles p on p.user_id=u.id
left join public.user_groups ug on ug.user_id=u.id left join public.groups g on g.id=ug.group_id
where u.email like 'test-%@example.com' order by u.email;
```
(Note: the inner `g_code_match` line is illustrative — use the literal `(select id from public.groups where code = code)` as shown on the `insert into public.user_groups` line; the `select id into gid` line can be dropped.) Expected: 4 rows, each `is_admin=false, is_active=true`, group = its code.

- [ ] **Step 2: Pick safe test jobs.** Via `execute_sql`, get one `ai_seo` job id (with its deal), one standalone `local_seo`, one `web_seo`, one `web_dev` (each `parent_job_id is null`), plus the deal id of the `ai_seo` job for the accounting check:

```sql
select 'ai_seo' as kind, j.id as job_id, j.deal_id from public.jobs j where j.service_type='ai_seo' and not j.archived limit 1;
```
(repeat for local_seo/web_seo/web_dev with `parent_job_id is null`). Record the ids.

- [ ] **Step 3: Local user UI test.** Playwright: log in as `test-local_seo@example.com` / `123456789`. Open the AI SEO job (`/jobs/<ai_seo_job_id>`) → Info tab. In the **Local SEO** area, pick a file named `SMOKE-local.txt` and Upload → it appears. In the **Web SEO** area, confirm there is **no** upload control. Open the standalone `local_seo` job → upload `SMOKE-local2.txt` in its Local area (succeeds).

- [ ] **Step 4: Web user UI test.** Log out, log in as `test-web_seo@example.com`. On the AI SEO job Info tab, the **Web SEO** area shows an upload control → upload `SMOKE-web.txt` (succeeds); the **Local SEO** area shows **no** upload control (but lists the Local file as a read-only download). On the `web_seo` job → upload succeeds.

- [ ] **Step 5: Web Dev user UI test.** Log in as `test-web_dev@example.com`. On the `web_dev` job Info tab → upload `SMOKE-webdev.txt` in the Web Dev area (succeeds). On a `local_seo`/`web_seo`/AI SEO job, confirm no upload control in those areas.

- [ ] **Step 6: Accounting deal view.** Log in as `test-accounting@example.com`. Open the AI SEO job's deal (`/deals/<deal_id>`) → the **Service files** card shows the uploaded files grouped by area as download links; confirm **no** upload/delete controls; click a link → it downloads/opens.

- [ ] **Step 7: Record findings.** Note any real problem encountered as a user (missing control, error toast, broken download, layout). If a bug is found, fix it (new commit), rebuild, redeploy, re-test the affected step.

- [ ] **Step 8: Cleanup — attachments (Storage + rows).** Gather the `SMOKE-*` attachments and remove both the Storage objects and the rows. Storage removal can't run from SQL; do it from a Playwright `browser_run_code_unsafe` step using the signed client, OR delete via the app's delete control as an owning user, OR list paths and remove via the Storage API in a small script. Then:

```sql
delete from public.attachments where file_name like 'SMOKE-%' and parent_type='job';
select count(*) as smoke_left from public.attachments where file_name like 'SMOKE-%';
```
Expected `smoke_left = 0`. Confirm the Storage bucket has no orphaned `SMOKE-*` objects.

- [ ] **Step 9: Cleanup — test accounts.** Delete the four test users (cascades identities/profile/user_groups):

```sql
delete from auth.users where email like 'test-%@example.com';
select count(*) as users_left from auth.users where email like 'test-%@example.com';
```
Expected `users_left = 0`.

- [ ] **Step 10:** No commit (verification only).

---

## Self-Review (completed during planning)

**Spec coverage:** RLS gate (svc_* → group) → Task 1/2; areas mapping incl. AI SEO split + child suppression → Task 3; upload kind widening → Task 4; gated Info-tab area UI → Task 5/6; generic-tab svc_* hidden → Task 6/7; deal read-only Service files → Task 8; i18n → Task 9; build/test/deploy → Task 10; **real-user per-group UI test + attachment & account cleanup** → Task 11. ✓

**Placeholder scan:** Task 11 Step 1 flags the one illustrative line and gives the literal to use; no TBD/TODO elsewhere; all code blocks complete. ✓

**Type consistency:** `ServiceArea`/`AreaKind`/`areasForJob`/`canUploadArea`/`areaForKind`/`SERVICE_AREA_KINDS` defined in `serviceAreas.ts` (Task 3) and imported by `ServiceAttachmentsSection` (Task 5), `JobDetailPage` (Task 6), `useDealServiceAttachments`/`DealServiceAttachments` (Task 8). `useUploadAttachment` `kind` union (Task 4) includes the `svc_*` values passed in Task 5. `useDeleteAttachment` vars `{id, storage_path, parent_type, parent_id}` match Task 5's call. `AttachmentsPanel` `hideKinds` (Task 7) matches the prop passed in Task 6. ✓
