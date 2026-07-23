import { describe, it, expect } from 'vitest';
import { validateAttachmentRefs, toBase64, fetchAttachments, fetchMimeAttachments, MAX_TOTAL_BYTES } from './attachments';

describe('validateAttachmentRefs', () => {
  it('accepts refs in allowlisted buckets', () => {
    const refs = validateAttachmentRefs([
      { bucket: 'contract-pdfs', path: 'contracts/abc.pdf', filename: 'CTR-202606-0001.pdf' },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0].filename).toBe('CTR-202606-0001.pdf');
  });

  it('rejects non-allowlisted buckets', () => {
    expect(() =>
      validateAttachmentRefs([{ bucket: 'avatars', path: 'x', filename: 'x.pdf' }]),
    ).toThrow(/bucket not allowed/);
  });

  it('rejects more than 10 attachments and malformed refs', () => {
    const ref = { bucket: 'contract-pdfs', path: 'p', filename: 'f.pdf' };
    expect(() => validateAttachmentRefs(Array(11).fill(ref))).toThrow(/too many/);
    expect(validateAttachmentRefs(Array(10).fill(ref))).toHaveLength(10); // cap is inclusive
    expect(() => validateAttachmentRefs([{ bucket: 'contract-pdfs' }])).toThrow(/invalid attachment/);
    expect(() => validateAttachmentRefs('nope')).toThrow(/invalid attachment/);
  });

  it('allows the attachments bucket and carries mimeType through', () => {
    const refs = validateAttachmentRefs([
      { bucket: 'attachments', path: 'compose/u1/x.png', filename: 'x.png', mimeType: 'image/png' },
    ]);
    expect(refs[0].bucket).toBe('attachments');
    expect(refs[0].mimeType).toBe('image/png');
    // non-string mimeType is dropped, not carried as a bad value
    const noType = validateAttachmentRefs([
      { bucket: 'attachments', path: 'compose/u1/y.pdf', filename: 'y.pdf', mimeType: 42 },
    ]);
    expect(noType[0].mimeType).toBeUndefined();
  });

  it('rejects traversal, empty, and malformed paths', () => {
    const bad = [
      '../avatars/x.png', 'a/../../x', '', 'a//b', './x', 'a/./b', 'a\\b', 'a/%2e%2e/b',
      // WHATWG URL parser strips \t \n \r before parsing — these reassemble into dot segments
      '.\t./avatars/x', '.\n./avatars/x', '.\r./avatars/x', 'a/.\t./.\t./avatars/x', 'a/ x', 'a b/x',
    ];
    for (const path of bad) {
      expect(
        () => validateAttachmentRefs([{ bucket: 'contract-pdfs', path, filename: 'x.pdf' }]),
        path,
      ).toThrow(/invalid attachment path/);
    }
    // sane nested path still accepted
    expect(validateAttachmentRefs([
      { bucket: 'contract-pdfs', path: 'contracts/abc.pdf', filename: 'x.pdf' },
    ])).toHaveLength(1);
  });
});

describe('toBase64', () => {
  it('encodes bytes, including > 32KB inputs (chunked)', () => {
    expect(toBase64(new TextEncoder().encode('hello'))).toBe(btoa('hello'));
    const big = new Uint8Array(100_000).fill(65);
    expect(toBase64(big)).toBe(btoa('A'.repeat(100_000)));
  });
});

describe('fetchAttachments', () => {
  const blobOf = (s: string) => ({
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(s).buffer as ArrayBuffer),
  });

  it('downloads each ref and returns Resend-shaped attachments', async () => {
    const storage = {
      from: (bucket: string) => ({
        download: (path: string) =>
          Promise.resolve({ data: blobOf(`${bucket}/${path}`), error: null }),
      }),
    };
    const out = await fetchAttachments(storage, [
      { bucket: 'contract-pdfs', path: 'contracts/a.pdf', filename: 'a.pdf' },
    ]);
    expect(out).toEqual([{ filename: 'a.pdf', content: btoa('contract-pdfs/contracts/a.pdf') }]);
  });

  it('throws when a download fails', async () => {
    const storage = {
      from: () => ({
        download: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
      }),
    };
    await expect(
      fetchAttachments(storage, [{ bucket: 'contract-pdfs', path: 'x', filename: 'x.pdf' }]),
    ).rejects.toThrow(/attachment download failed/);
  });
});

describe('fetchMimeAttachments', () => {
  // storage stub that returns a Blob-like of `n` bytes for any download
  const storageOf = (n: number) => ({
    from: () => ({
      download: () =>
        Promise.resolve({ data: { arrayBuffer: () => Promise.resolve(new Uint8Array(n).buffer) }, error: null }),
    }),
  });

  it('returns filename/mimeType/base64/bytes and defaults an absent mimeType', async () => {
    const out = await fetchMimeAttachments(storageOf(3), [
      { bucket: 'attachments', path: 'a/x.png', filename: 'x.png', mimeType: 'image/png' },
      { bucket: 'attachments', path: 'a/y.bin', filename: 'y.bin' },
    ]);
    expect(out[0]).toEqual({ filename: 'x.png', mimeType: 'image/png', base64: btoa('\x00\x00\x00'), bytes: 3 });
    expect(out[1].mimeType).toBe('application/octet-stream');
  });

  it('throws attachments_too_large once the summed raw bytes exceed MAX_TOTAL_BYTES', async () => {
    // two halves each just over MAX_TOTAL_BYTES/2 → second push trips the guard
    const half = Math.ceil(MAX_TOTAL_BYTES / 2) + 1;
    await expect(
      fetchMimeAttachments(storageOf(half), [
        { bucket: 'attachments', path: 'a/1', filename: '1' },
        { bucket: 'attachments', path: 'a/2', filename: '2' },
      ]),
    ).rejects.toThrow(/attachments_too_large/);
  });
});
