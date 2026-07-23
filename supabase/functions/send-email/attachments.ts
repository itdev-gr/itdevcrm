// Storage-backed email attachments for the send-email function.
// Refs are validated against a bucket allowlist (callers hold staff JWTs, but
// the download below runs service-role — never let arbitrary buckets through).

export type AttachmentRef = { bucket: string; path: string; filename: string; mimeType?: string };
export type ResendAttachment = { filename: string; content: string };
export type MimeAttachment = { filename: string; mimeType: string; base64: string; bytes: number };

const ALLOWED_BUCKETS = new Set(['contract-pdfs', 'offer-pdfs', 'attachments']);
const MAX_ATTACHMENTS = 10;
export const MAX_TOTAL_BYTES = 18 * 1024 * 1024; // ~18MB raw → base64 stays under Gmail's 25MB

export function validateAttachmentRefs(input: unknown): AttachmentRef[] {
  if (!Array.isArray(input)) throw new Error('invalid attachments: not an array');
  if (input.length > MAX_ATTACHMENTS) throw new Error('too many attachments (max 10)');
  return input.map((raw) => {
    const r = raw as Partial<AttachmentRef> | null;
    if (!r || typeof r.bucket !== 'string' || typeof r.path !== 'string' || typeof r.filename !== 'string') {
      throw new Error('invalid attachment ref');
    }
    if (!ALLOWED_BUCKETS.has(r.bucket)) throw new Error(`attachment bucket not allowed: ${r.bucket}`);
    // Positive allowlist: storage-js does not encode path segments and the
    // WHATWG URL parser strips \t \n \r and normalizes dot segments, so any
    // character outside this set (and any '', '.', '..' segment) could let a
    // crafted path escape the allowlisted bucket. Generated PDF paths are
    // always of the form 'contracts/<uuid>.pdf'.
    if (
      !/^[A-Za-z0-9._/-]+$/.test(r.path) ||
      r.path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
    ) {
      throw new Error(`invalid attachment path: ${r.path}`);
    }
    return {
      bucket: r.bucket,
      path: r.path,
      filename: r.filename,
      mimeType: typeof r.mimeType === 'string' ? r.mimeType : undefined,
    };
  });
}

export function toBase64(bytes: Uint8Array): string {
  // String.fromCharCode(...big) overflows the arg limit — chunk it.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

type StorageLike = {
  from(bucket: string): {
    download(path: string): Promise<{
      data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
      error: { message: string } | null;
    }>;
  };
};

export async function fetchAttachments(
  storage: StorageLike,
  refs: AttachmentRef[],
): Promise<ResendAttachment[]> {
  const out: ResendAttachment[] = [];
  for (const ref of refs) {
    const { data, error } = await storage.from(ref.bucket).download(ref.path);
    if (error || !data) {
      throw new Error(`attachment download failed (${ref.bucket}/${ref.path}): ${error?.message ?? 'no data'}`);
    }
    out.push({ filename: ref.filename, content: toBase64(new Uint8Array(await data.arrayBuffer())) });
  }
  return out;
}

// Gmail path: fetch each ref service-role and return the raw byte size alongside
// the base64 payload so the caller can enforce a total-size guard. Throws
// `attachments_too_large` when the summed raw bytes exceed MAX_TOTAL_BYTES.
export async function fetchMimeAttachments(
  storage: StorageLike,
  refs: AttachmentRef[],
): Promise<MimeAttachment[]> {
  const out: MimeAttachment[] = [];
  let total = 0;
  for (const ref of refs) {
    const { data, error } = await storage.from(ref.bucket).download(ref.path);
    if (error || !data) {
      throw new Error(`attachment download failed (${ref.bucket}/${ref.path}): ${error?.message ?? 'no data'}`);
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('attachments_too_large');
    out.push({
      filename: ref.filename,
      mimeType: ref.mimeType ?? 'application/octet-stream',
      base64: toBase64(bytes),
      bytes: bytes.length,
    });
  }
  return out;
}
