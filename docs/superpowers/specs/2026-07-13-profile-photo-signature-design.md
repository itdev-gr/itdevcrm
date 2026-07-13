# Profile photo upload → personal signature image — design

**Date:** 2026-07-13 · **Status:** approved by owner (chat) · **Extends:** [2026-07-13-email-signature-design.md](2026-07-13-email-signature-design.md)

## Goal

Each user can upload their own photo on My Profile. The personal email signature's
round image slot shows that photo; users without a photo keep the round IT DEV logo
(current behavior). Automated/company emails always keep the IT DEV logo.

## Decisions (owner defaults, 2026-07-13)

- Photo appears in the **signature + My Profile page only** — the top-bar letter
  avatar is untouched (YAGNI).
- **Auto center-crop**: on upload the browser center-crops the image square and
  downscales to 400×400 PNG via canvas. No manual crop dialog.

## Design

1. **Storage:** new **public** bucket `avatars` (migration). Public read (mail
   clients fetch images anonymously). Write access: authenticated users may
   INSERT/UPDATE/DELETE **only their own fixed key** `<user_id>.png`
   (`storage.objects` policies checking `bucket_id = 'avatars' and name =
   auth.uid()::text || '.png'`; upsert needs insert + update). Nobody can touch a
   colleague's photo.
2. **Upload UI:** `src/features/users/ProfilePhotoUpload.tsx` replaces the bare
   "Avatar URL" text input on `MyProfilePage`. Round preview (photo, else the
   IT DEV logo), **Upload photo** (file picker, `image/*`) and **Remove** buttons.
   On pick: canvas center-crop square → 400×400 PNG blob →
   `storage.from('avatars').upload('<user_id>.png', blob, { upsert: true })` →
   store `publicUrl + '?v=' + Date.now()` into the page's existing `avatar_url`
   autosave patch (cache-busting so photo replacement propagates). Remove:
   `storage.remove(['<user_id>.png'])` + `avatar_url = null`. Upload errors surface
   inline; the old value stays.
3. **Signature plumbing:** the personal variant's image = `avatar_url` when set,
   else the default logo — in all three render sites:
   - `sendPersonal` (send-email/index.ts): add `avatar_url` to the profile select;
     `logoUrl = (avatar_url startsWith 'https://') ? avatar_url : LOGO_URL`.
   - My Profile live preview: pass the form's live `avatarUrl` state.
   - `MySignaturePreview` (compose dialog): add `avatar_url` to its select.
   `SignaturePreview` gains an optional `logoUrl` prop (default: origin IT DEV logo).
   Company/automated paths unchanged.
4. **Security fix (folded in):** `renderSignatureHtml` currently interpolates
   `logoUrl` into `<img src>` UNESCAPED — fine for our constants, not for
   user-influenced `avatar_url`. The renderer now escapes it (`esc(logoUrl)`), and
   the edge fn additionally accepts only `https://…` values (else falls back).
5. **Legacy values:** `avatar_url` was a free-text URL field; old hand-typed values
   keep working (or were broken already) and are replaced on first upload.

## Out of scope (YAGNI)

Top-bar/header avatar, comments/tasks avatars, manual crop UI, non-PNG output,
image moderation, multiple photos.

## Testing

- Renderer: escape test for a hostile `logoUrl`; avatar-vs-default selection is
  frontend/edge-fn logic covered by component test + live E2E.
- `SignaturePreview`: `logoUrl` prop respected; default unchanged.
- Live E2E after rollout (mkifokeris): preview shows default logo → upload photo →
  preview flips to photo → personal send → inbox shows photo in signature;
  automated emails still show the IT DEV logo.

## Changes / Revert

Changes: 1 migration (`avatars` bucket + own-key policies), `signature.ts` (escape),
`send-email/index.ts` (select + fallback), `SignaturePreview.tsx`,
`ProfilePhotoUpload.tsx` (new), `MyProfilePage.tsx`, i18n en/el `users.json`.
Revert: git revert the commits + redeploy send-email; drop the two policies and the
bucket (`delete from storage.buckets where id='avatars'` after emptying); stale
`avatar_url` values are harmless (signature falls back once the code is reverted).
