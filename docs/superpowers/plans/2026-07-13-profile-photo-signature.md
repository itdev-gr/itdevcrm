# Profile Photo → Signature Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users upload a photo on My Profile; the personal email signature shows it in the round image slot, falling back to the IT DEV logo when absent.

**Architecture:** New public `avatars` storage bucket with own-key-only write policies. A `ProfilePhotoUpload` component (canvas center-crop → 400×400 PNG → upsert to `<user_id>.png` → versioned public URL into the existing `profiles.avatar_url` autosave). The three signature render sites (edge fn `sendPersonal`, My Profile live preview, compose-dialog preview) pass `avatar_url || default logo`. The shared renderer gains `esc()` on `logoUrl` (user-influenced now).

**Tech Stack:** React + Vite + vitest, Supabase Storage + edge functions (Deno), prod project `xujlrclyzxrvxszepquy`.

**Spec:** `docs/superpowers/specs/2026-07-13-profile-photo-signature-design.md` — read it first.

## Global Constraints

- `npm run build` (= `tsc -b && eslint . --max-warnings=0 && vite build`) MUST pass after every task.
- **NEVER run the full vitest suite** (hits PROD Supabase). Run only the test files named in each task.
- Migrations are NOT applied and the edge fn NOT deployed until Task 4.
- Fixed storage key per user: `<user_id>.png` (upsert replaces). Stored URL format: `<publicUrl>?v=<Date.now()>` (cache-busting).
- Only `https://`-prefixed `avatar_url` values are honored by the signature (else IT DEV logo fallback).
- Commit per task; push only in Task 4. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The owner's parallel sessions commit in this same tree — `git status` before each commit; stage ONLY the files this plan names.

---

### Task 1: `avatars` bucket migration

**Files:**
- Create: `supabase/migrations/20260713150000_avatars_bucket.sql`

**Interfaces:**
- Produces: public bucket `avatars`; authenticated users can write only `auth.uid() || '.png'`. Task 3's upload code and Task 4's rollout depend on it.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Public `avatars` bucket: per-user profile photos shown in the personal email
-- signature (spec 2026-07-13-profile-photo-signature-design.md).
-- Public read (mail clients fetch images anonymously via /object/public/…).
-- Writes: each authenticated user may touch ONLY their own fixed key
-- `<user_id>.png` — upsert needs insert + update; remove needs delete.
-- =============================================================================

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.png');

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.png')
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.png');

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.png');

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop policy if exists "avatars_insert_own" on storage.objects;
--   drop policy if exists "avatars_update_own" on storage.objects;
--   drop policy if exists "avatars_delete_own" on storage.objects;
--   delete from storage.objects where bucket_id = 'avatars';
--   delete from storage.buckets where id = 'avatars';
-- ---------------------------------------------------------------------------
```

- [ ] **Step 2: Sanity gate**

Run: `npm run build` — Expected: exit 0 (nothing else broken in the tree).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260713150000_avatars_bucket.sql
git commit -m "feat(profile): avatars bucket (public read, own-key writes)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Renderer escape + edge-fn avatar plumbing (TDD)

**Files:**
- Modify: `supabase/functions/_shared/signature.ts` (line ~62, the `<img src>` interpolation)
- Modify: `supabase/functions/send-email/index.ts` (function `sendPersonal`, profile select + `renderSignatureHtml` call)
- Test: `src/features/email/emailSignature.test.ts` (append one describe block)

**Interfaces:**
- Consumes: existing `renderSignatureHtml(logoUrl, person?)`, `LOGO_URL` export from `./templates.ts`.
- Produces: renderer escapes `logoUrl`; `sendPersonal` selects `avatar_url` and passes `https://`-guarded avatar (else `LOGO_URL`). Task 3 mirrors the same guard client-side.

- [ ] **Step 1: Write the failing test** — append to `src/features/email/emailSignature.test.ts`:

```ts
describe('renderSignatureHtml — logoUrl escaping', () => {
  it('escapes a hostile logoUrl instead of letting it break out of src', () => {
    const html = renderSignatureHtml('https://x/a.png" onerror="alert(1)');
    expect(html).not.toContain('" onerror="');
    expect(html).toContain('src="https://x/a.png&quot; onerror=&quot;alert(1)"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/email/emailSignature.test.ts`
Expected: FAIL — the raw `" onerror="` survives (logoUrl is currently unescaped).

- [ ] **Step 3: Implement** — in `supabase/functions/_shared/signature.ts` change the img line (~62):

```ts
<td style="vertical-align:middle;padding-right:16px"><img src="${esc(logoUrl)}" width="80" height="80" alt="IT DEV" style="display:block;border-radius:50%"/></td>
```

(only `${logoUrl}` → `${esc(logoUrl)}` changes on that line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/email/emailSignature.test.ts`
Expected: PASS (all tests, including the pre-existing ones — `esc()` leaves normal URLs untouched).

- [ ] **Step 5: Edge fn — use the sender's avatar**. In `supabase/functions/send-email/index.ts`, `sendPersonal`:

change the select:
```ts
    .select('full_name, job_title, phone, email, avatar_url')
```
and replace `const sig = renderSignatureHtml(LOGO_URL, {` with:

```ts
  // Photo slot: the user's uploaded avatar when it's a real https URL,
  // else the IT DEV logo (spec: profile-photo-signature).
  const avatar =
    typeof prof?.avatar_url === 'string' && prof.avatar_url.startsWith('https://')
      ? prof.avatar_url
      : null;
  const sig = renderSignatureHtml(avatar ?? LOGO_URL, {
```
(the person-fields object and everything after stay unchanged.)

- [ ] **Step 6: Gates**

Run: `deno check --node-modules-dir=auto supabase/functions/send-email/index.ts` — Expected: clean.
Run: `npm run build` — Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/signature.ts supabase/functions/send-email/index.ts src/features/email/emailSignature.test.ts
git commit -m "feat(email): personal signature uses sender avatar; escape logoUrl

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Upload UI + preview plumbing + i18n (TDD)

**Files:**
- Create: `src/features/users/ProfilePhotoUpload.tsx`
- Modify: `src/features/email/SignaturePreview.tsx` (optional `logoUrl` prop; `MySignaturePreview` selects `avatar_url`)
- Modify: `src/features/users/MyProfilePage.tsx` (replace the avatar-URL text input, lines ~147–154; pass live `logoUrl` to the signature card)
- Modify: `src/i18n/locales/en/users.json`, `src/i18n/locales/el/users.json`
- Test: `src/features/email/SignaturePreview.test.tsx` (append)

**Interfaces:**
- Consumes: bucket `avatars` (Task 1), `SignaturePerson` type.
- Produces: `SignaturePreview({ person, logoUrl? })` — `logoUrl?: string | null`, honored only when it starts with `https://`; `ProfilePhotoUpload({ userId, value, onChange })` — `value: string | null`, `onChange(url: string | null)`.

- [ ] **Step 1: Write the failing test** — append to `src/features/email/SignaturePreview.test.tsx`:

```tsx
describe('SignaturePreview logoUrl prop', () => {
  it('uses the provided https logoUrl in the rendered signature', () => {
    render(
      <SignaturePreview
        person={{ name: 'X', email: 'x@itdev.gr' }}
        logoUrl="https://cdn.example/avatars/u.png?v=1"
      />,
    );
    const doc = screen.getByTitle('signature-preview').getAttribute('srcdoc') ?? '';
    expect(doc).toContain('https://cdn.example/avatars/u.png?v=1');
    expect(doc).not.toContain('/email-assets/itdev-logo-round.png');
  });
  it('falls back to the default logo when logoUrl is null', () => {
    render(<SignaturePreview person={{ name: 'X', email: 'x@itdev.gr' }} logoUrl={null} />);
    const doc = screen.getByTitle('signature-preview').getAttribute('srcdoc') ?? '';
    expect(doc).toContain('/email-assets/itdev-logo-round.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/email/SignaturePreview.test.tsx`
Expected: FAIL — `logoUrl` prop doesn't exist yet (TS/type error or default logo used).

- [ ] **Step 3: Implement `SignaturePreview` changes** — replace the two components' signatures/bodies:

```tsx
// Same fixed layout for everyone — the preview is the renderer the emails use.
// logoUrl: the user's avatar (honored only when https), else the IT DEV logo.
export function SignaturePreview({
  person,
  logoUrl,
}: {
  person: SignaturePerson;
  logoUrl?: string | null;
}) {
  const src =
    logoUrl && logoUrl.startsWith('https://')
      ? logoUrl
      : `${window.location.origin}/email-assets/itdev-logo-round.png`;
  return (
    <iframe
      title="signature-preview"
      sandbox=""
      srcDoc={`<body style="margin:8px;background:#ffffff">${renderSignatureHtml(src, person)}</body>`}
      className="h-72 w-full rounded border bg-white"
    />
  );
}
```
In `MySignaturePreview`: select becomes `'full_name, job_title, phone, email, avatar_url'` and the return adds the prop:
```tsx
  return (
    <SignaturePreview
      logoUrl={q.data.avatar_url}
      person={{
        name: q.data.full_name ?? '',
        title: q.data.job_title,
        phone: q.data.phone,
        email: q.data.email,
      }}
    />
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/email/SignaturePreview.test.tsx`
Expected: PASS (new + pre-existing tests).

- [ ] **Step 5: Create `src/features/users/ProfilePhotoUpload.tsx`**

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';

/**
 * Profile photo used in the email signature. Fixed storage key <userId>.png in
 * the public `avatars` bucket (upsert); stored value is the public URL with a
 * ?v= cache-buster so replacing the photo propagates to mail clients.
 */
export function ProfilePhotoUpload({
  userId,
  value,
  onChange,
}: {
  userId: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const { t } = useTranslation('users');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const defaultLogo = `${window.location.origin}/email-assets/itdev-logo-round.png`;

  async function toSquarePng(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      400,
      400,
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(false);
    setBusy(true);
    try {
      const blob = await toSquarePng(file);
      const key = `${userId}.png`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(key, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) throw new Error(upErr.message);
      const { data } = supabase.storage.from('avatars').getPublicUrl(key);
      onChange(`${data.publicUrl}?v=${Date.now()}`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemove() {
    setError(false);
    setBusy(true);
    try {
      await supabase.storage.from('avatars').remove([`${userId}.png`]);
    } finally {
      onChange(null);
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 flex items-center gap-4">
      <img
        src={value || defaultLogo}
        alt={t('profile.photo_title', { defaultValue: 'Profile photo' })}
        className="h-20 w-20 rounded-full border object-cover"
      />
      <div className="space-y-1">
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy
              ? t('profile.photo_uploading', { defaultValue: 'Uploading…' })
              : t('profile.photo_upload', { defaultValue: 'Upload photo' })}
          </button>
          {value && (
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm text-muted-foreground"
              disabled={busy}
              onClick={onRemove}
            >
              {t('profile.photo_remove', { defaultValue: 'Remove' })}
            </button>
          )}
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('profile.photo_error', { defaultValue: 'Upload failed — try another image.' })}
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={t('profile.photo_upload', { defaultValue: 'Upload photo' })}
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
```
(No component test — canvas/`createImageBitmap` don't exist in jsdom; the live E2E in Task 4 exercises the real path.)

- [ ] **Step 6: Wire into `MyProfilePage.tsx`**

Add imports:
```tsx
import { ProfilePhotoUpload } from './ProfilePhotoUpload';
```
Replace the avatar-URL block (currently `<div className="md:col-span-2"> <Label htmlFor="av">{t('profile.avatar_url')}</Label> <Input id="av" type="url" … /> </div>`, lines ~147–154) with:

```tsx
        <div className="md:col-span-2">
          <Label>{t('profile.photo_title', { defaultValue: 'Profile photo' })}</Label>
          <ProfilePhotoUpload
            userId={userId}
            value={avatarUrl.trim() || null}
            onChange={(url) => setAvatarUrl(url ?? '')}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t('profile.photo_hint', {
              defaultValue:
                'Shown in your email signature. Without a photo, the IT DEV logo is used.',
            })}
          </p>
        </div>
```
(`avatar_url` is already in the autosave patch — `onChange` feeds the existing `avatarUrl` state, autosave persists it.)

Then pass the live value to the signature card in the same file — the existing "Email signature" card's `<SignaturePreview person={{ … }} />` gains:
```tsx
          <SignaturePreview
            logoUrl={avatarUrl.trim() || null}
            person={{ ...unchanged person object... }}
          />
```
(keep the existing `person` object exactly as it is; only add the `logoUrl` prop. Do not literally write "...unchanged person object..." — keep the current code.)

- [ ] **Step 7: i18n keys** — add inside the `"profile"` object:

`src/i18n/locales/en/users.json`:
```json
"photo_title": "Profile photo",
"photo_upload": "Upload photo",
"photo_uploading": "Uploading…",
"photo_remove": "Remove",
"photo_hint": "Shown in your email signature. Without a photo, the IT DEV logo is used.",
"photo_error": "Upload failed — try another image."
```
`src/i18n/locales/el/users.json`:
```json
"photo_title": "Φωτογραφία προφίλ",
"photo_upload": "Μεταφόρτωση φωτογραφίας",
"photo_uploading": "Μεταφόρτωση…",
"photo_remove": "Αφαίρεση",
"photo_hint": "Εμφανίζεται στην υπογραφή email σας. Χωρίς φωτογραφία, χρησιμοποιείται το λογότυπο IT DEV.",
"photo_error": "Η μεταφόρτωση απέτυχε — δοκιμάστε άλλη εικόνα."
```
Validate both parse: `python3 -c "import json;json.load(open('src/i18n/locales/en/users.json'));json.load(open('src/i18n/locales/el/users.json'));print('OK')"`

- [ ] **Step 8: Gates**

Run: `npm run build && npm run test:run -- src/features/email/SignaturePreview.test.tsx src/features/email/emailSignature.test.ts`
Expected: build exit 0; both files PASS. (The old `profile.avatar_url` i18n key may remain unused in the JSONs — leave it; removing keys risks other references.)

- [ ] **Step 9: Commit**

```bash
git add src/features/users/ProfilePhotoUpload.tsx src/features/users/MyProfilePage.tsx \
  src/features/email/SignaturePreview.tsx src/features/email/SignaturePreview.test.tsx \
  src/i18n/locales/en/users.json src/i18n/locales/el/users.json
git commit -m "feat(profile): photo upload feeding the personal signature image

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Rollout + live E2E (prod) — main session

⚠️ Needs a valid `sbp_` Management-API token (owner) and the owner's inbox eyeball.

- [ ] **Step 1: Apply the bucket migration** via the Management API query endpoint (same recipe as the signature rollout: write the .sql into a `{"query": …}` JSON, POST to `/v1/projects/xujlrclyzxrvxszepquy/database/query`). Verify:
```sql
select id, public from storage.buckets where id = 'avatars';                     -- avatars / true
select policyname from pg_policies where tablename = 'objects'
  and policyname like 'avatars_%';                                              -- 3 rows
```

- [ ] **Step 2: Push** (`git pull --rebase && git push`) and wait for Vercel; then deploy the edge fn:
```bash
SUPABASE_ACCESS_TOKEN=<sbp> npx supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy --no-verify-jwt
```
(`--no-verify-jwt` REQUIRED — drain auth. No unsigned-email window this time: the code change is avatar-or-default, safe in any order.)

- [ ] **Step 3: Live E2E via Playwright as mkifokeris@itdev.gr** (pw = standard test pw):
0. **Pre-check (clear legacy avatar):** `select avatar_url from profiles where email='mkifokeris@itdev.gr'`. If a non-null legacy value exists, clear it first (`update profiles set avatar_url = null where email='mkifokeris@itdev.gr'`) — otherwise the "default logo first" assertion in 1 fails spuriously.
1. `/profile` → the photo control shows the DEFAULT logo; signature card shows default logo.
2. Generate a test photo locally (e.g. PIL: 300×500 colored rectangle with a circle, PNG — non-square on purpose) and upload it via the file input (`browser_file_upload`).
3. Photo preview + signature card flip to the uploaded (center-cropped square) image; autosave label shows saved.
4. Verify the public object: `curl -sI 'https://xujlrclyzxrvxszepquy.supabase.co/storage/v1/object/public/avatars/<maria_user_id>.png' | grep -i '^content-type: image/png'`.
5. Compose a personal email (any lead → Emails → New email) to `mkifokeris@itdev.gr`, subject "Photo signature E2E"; expand the dialog preview — must show the photo; Send; `email_log` row `status='sent'`.
6. **Replacement (proves upsert / the SELECT policy fix):** upload a SECOND, visibly different photo via the same control — the photo preview + signature card must switch to the new image (a failed overwrite would leave the first photo showing).
7. Owner eyeballs the email in Maria's inbox: photo renders round in the signature.
8. **Remove assertion:** click Remove on /profile → preview + signature card fall back to the IT DEV logo, AND `curl -sI 'https://xujlrclyzxrvxszepquy.supabase.co/storage/v1/object/public/avatars/<maria_user_id>.png'` returns **400/404** (the object is really gone, not just unlinked from the profile).

- [ ] **Step 4: Close out** — remind sbp_ rotation; update memory (`project_email_signature.md` gains the avatar mechanics + bucket; MEMORY.md line updated); mark plan checkboxes; final ledger entry.

---

## Changes / Revert (whole feature)

**Changes:** Tasks 1–3 commits + prod: `avatars` bucket + policies, send-email redeploy.
**Revert:** git revert the commits, redeploy send-email; drop the 3 `avatars_*` policies, empty + delete the bucket (rollback SQL in the migration header). Stale `avatar_url` values are harmless post-revert (renderer falls back).
