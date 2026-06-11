import { describe, it, expect } from 'vitest';
import { validateAttachmentRefs, toBase64, fetchAttachments } from './attachments';

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

  it('rejects more than 3 attachments and malformed refs', () => {
    const ref = { bucket: 'contract-pdfs', path: 'p', filename: 'f.pdf' };
    expect(() => validateAttachmentRefs([ref, ref, ref, ref])).toThrow(/too many/);
    expect(() => validateAttachmentRefs([{ bucket: 'contract-pdfs' }])).toThrow(/invalid attachment/);
    expect(() => validateAttachmentRefs('nope')).toThrow(/invalid attachment/);
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
