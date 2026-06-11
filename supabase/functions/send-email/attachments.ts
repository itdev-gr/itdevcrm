// Storage-backed email attachments for the send-email function.
// Refs are validated against a bucket allowlist (callers hold staff JWTs, but
// the download below runs service-role — never let arbitrary buckets through).

export type AttachmentRef = { bucket: string; path: string; filename: string };
export type ResendAttachment = { filename: string; content: string };

const ALLOWED_BUCKETS = new Set(['contract-pdfs', 'offer-pdfs']);
const MAX_ATTACHMENTS = 3;

export function validateAttachmentRefs(input: unknown): AttachmentRef[] {
  if (!Array.isArray(input)) throw new Error('invalid attachments: not an array');
  if (input.length > MAX_ATTACHMENTS) throw new Error('too many attachments (max 3)');
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
    return { bucket: r.bucket, path: r.path, filename: r.filename };
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
