/**
 * Pure mapping from a job's Info-tab assets to a flat list of ZIP entries.
 *
 * The Info tab (see JobDetailPage `TabsContent value="info"`) surfaces three
 * asset sources:
 *   - the client-intake logo (bucket `client-intake`)
 *   - the client-intake uploaded files (bucket `client-intake`)
 *   - the per-service attachment areas (bucket `attachments`)
 *
 * `useDownloadJobAssets` batch-signs each entry's `path` in its `bucket`,
 * streams the bytes and packs them into a ZIP under `zipName`. This module owns
 * the folder layout, filename sanitisation and de-duplication so it can be unit
 * tested without any DOM / storage. Sanitisation strips path separators and
 * control characters (which would otherwise nest / escape folders) but KEEPS
 * unicode — Greek filenames are common here.
 */

export type AssetFile = { storage_path: string; file_name: string };
export type AttachmentArea = { label: string; files: AssetFile[] };

export type AssetZipInput = {
  logoPath: string | null;
  intakeFiles: AssetFile[];
  attachmentAreas: AttachmentArea[];
};

export type AssetBucket = 'client-intake' | 'attachments';

export type ZipEntry = {
  bucket: AssetBucket;
  path: string;
  zipName: string;
};

// Drop C0 control chars (0x00–0x1f) and DEL (0x7f); keep everything else,
// including unicode letters. A code-point scan avoids a control-char regex
// literal (eslint `no-control-regex`).
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

// Path separators become "_" (so a name never nests / escapes folders); control
// chars are removed. Unicode is preserved. Falls back to "file" when nothing
// printable survives.
function sanitizeName(name: string): string {
  const cleaned = stripControlChars(name).replace(/[/\\]+/g, '_').trim();
  return cleaned || 'file';
}

// Lowercase, hyphenated folder name for an attachment area label. Keeps unicode
// letters; collapses separators / whitespace to single hyphens.
function slugifyLabel(label: string): string {
  const slug = stripControlChars(label)
    .trim()
    .toLowerCase()
    .replace(/[\s/\\]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'area';
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

// Insert " (n)" before the file extension (or at the end when there is none).
// The extension is only the trailing ".ext" of the final path segment.
function withCopySuffix(zipName: string, n: number): string {
  const slash = zipName.lastIndexOf('/');
  const dot = zipName.lastIndexOf('.');
  if (dot > slash + 1) {
    return `${zipName.slice(0, dot)} (${n})${zipName.slice(dot)}`;
  }
  return `${zipName} (${n})`;
}

// Ensure every zipName is unique, appending " (2)", " (3)", … as needed. Robust
// against a generated suffix colliding with a pre-existing name.
function dedupe(entries: ZipEntry[]): ZipEntry[] {
  const used = new Set<string>();
  return entries.map((entry) => {
    let name = entry.zipName;
    if (used.has(name)) {
      let n = 2;
      while (used.has(withCopySuffix(entry.zipName, n))) n += 1;
      name = withCopySuffix(entry.zipName, n);
    }
    used.add(name);
    return { ...entry, zipName: name };
  });
}

/**
 * Map a job's Info-tab assets to flat ZIP entries. Order: logo, then intake
 * files, then attachments grouped per area. Empty inputs yield `[]`.
 */
export function buildZipEntries(input: AssetZipInput): ZipEntry[] {
  const entries: ZipEntry[] = [];

  if (input.logoPath) {
    entries.push({
      bucket: 'client-intake',
      path: input.logoPath,
      zipName: `logo/${sanitizeName(basename(input.logoPath))}`,
    });
  }

  for (const file of input.intakeFiles) {
    entries.push({
      bucket: 'client-intake',
      path: file.storage_path,
      zipName: `client-files/${sanitizeName(file.file_name)}`,
    });
  }

  for (const area of input.attachmentAreas) {
    const slug = slugifyLabel(area.label);
    for (const file of area.files) {
      entries.push({
        bucket: 'attachments',
        path: file.storage_path,
        zipName: `attachments/${slug}/${sanitizeName(file.file_name)}`,
      });
    }
  }

  return dedupe(entries);
}
