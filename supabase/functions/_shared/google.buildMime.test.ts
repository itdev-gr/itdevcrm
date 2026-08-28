import { describe, it, expect } from 'vitest';
import { buildMime } from './google';

// buildMime is pure (btoa / crypto.randomUUID / TextEncoder only), so it runs
// under vitest exactly as the edge function does — same runner as google.test.ts.

// base64url (buildMime output) → the raw MIME as a binary string
const decodeMime = (raw: string): string => atob(raw.replace(/-/g, '+').replace(/_/g, '/'));

// same chunked base64 the send-email fn uses to prep attachment payloads
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

describe('buildMime — no attachments (single-part, backward compatible)', () => {
  it('decodes to a single text/html message with no multipart boundary', () => {
    const raw = buildMime({ from: 'a@itdev.gr', to: 'c@x.gr', subject: 'Γεια', html: '<p>σώμα</p>' });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no +/=
    const mime = decodeMime(raw);
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime).not.toContain('multipart/mixed');
    expect(mime).not.toContain('Content-Disposition: attachment');
    // the html body is the final line, base64 of the utf-8 html
    const body = mime.split('\r\n').pop()!;
    expect(decodeURIComponent(escape(atob(body)))).toBe('<p>σώμα</p>');
  });

  it('is byte-for-byte the pre-attachment single-part output', () => {
    // Recompute the legacy formula independently and assert equality.
    const enc = new TextEncoder();
    const b64url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const subj = `=?UTF-8?B?${btoa(unescape(encodeURIComponent('Γεια')))}?=`;
    const expected = b64url(
      enc.encode(
        [
          'From: a@itdev.gr',
          'To: c@x.gr',
          `Subject: ${subj}`,
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          btoa(unescape(encodeURIComponent('<p>σώμα</p>'))),
        ].join('\r\n'),
      ),
    );
    expect(buildMime({ from: 'a@itdev.gr', to: 'c@x.gr', subject: 'Γεια', html: '<p>σώμα</p>' })).toBe(expected);
  });

  it('treats an empty attachments array like no attachments', () => {
    const args = { from: 'a@itdev.gr', to: 'c@x.gr', subject: 'Hi', html: '<p>hi</p>' };
    expect(buildMime({ ...args, attachments: [] })).toBe(buildMime(args));
  });
});

describe('buildMime — with attachments (multipart/mixed)', () => {
  it('emits multipart/mixed and an attachment part whose base64 round-trips', () => {
    const inputBytes = new Uint8Array(200);
    for (let i = 0; i < inputBytes.length; i++) inputBytes[i] = (i * 7) % 256;
    const raw = buildMime({
      from: 'a@itdev.gr',
      to: 'c@x.gr',
      subject: 'Hi',
      html: '<p>hi</p>',
      attachments: [{ filename: 'a.png', mimeType: 'image/png', base64: toBase64(inputBytes) }],
    });
    const mime = decodeMime(raw);

    // structure
    expect(mime).toMatch(/Content-Type: multipart\/mixed; boundary="itdev_[0-9a-f]+"/);
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    expect(mime).toContain('Content-Type: image/png; name="a.png"');
    expect(mime).toContain('Content-Disposition: attachment; filename="a.png"');

    // extract + decode the attachment part's base64 back to the input bytes
    const boundary = mime.match(/boundary="(itdev_[0-9a-f]+)"/)![1];
    const attSeg = mime.split(`--${boundary}`).find((s) => s.includes('Content-Disposition: attachment'))!;
    const wrapped = attSeg.split('\r\n\r\n')[1];
    // RFC 2045: no encoded line exceeds 76 chars
    for (const line of wrapped.split('\r\n').filter(Boolean)) expect(line.length).toBeLessThanOrEqual(76);
    const b64 = wrapped.replace(/[\r\n]/g, '').replace(/--$/, '');
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(inputBytes));
  });

  it('sanitizes header-injection characters out of the filename', () => {
    const raw = buildMime({
      from: 'a@itdev.gr',
      to: 'c@x.gr',
      subject: 'Hi',
      html: '<p>hi</p>',
      attachments: [{ filename: 'e"vil\r\n\\.png', mimeType: 'image/png', base64: btoa('x') }],
    });
    const mime = decodeMime(raw);
    expect(mime).toContain('Content-Disposition: attachment; filename="e_vil___.png"');
    // no raw quote/backslash/CR/LF leaked into the disposition header line
    expect(mime).not.toContain('filename="e"vil');
  });

  it('handles a ~300KB attachment without RangeError (chunked base64url)', () => {
    // Regression: the old b64url spread the whole MIME message into
    // String.fromCharCode and blew the V8 arg/stack limit on real files.
    const big = new Uint8Array(300 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const raw = buildMime({
      from: 'a@itdev.gr',
      to: 'c@x.gr',
      subject: 'Η προσφορά μας',
      html: '<p>συνημμένο</p>',
      attachments: [{ filename: 'offer.pdf', mimeType: 'application/pdf', base64: toBase64(big) }],
    });
    const mime = decodeMime(raw);
    expect(mime).toContain('multipart/mixed');
    expect(mime).toContain('Content-Disposition: attachment; filename="offer.pdf"');

    const boundary = mime.match(/boundary="(itdev_[0-9a-f]+)"/)![1];
    const attSeg = mime.split(`--${boundary}`).find((s) => s.includes('Content-Disposition: attachment'))!;
    const b64 = attSeg.split('\r\n\r\n')[1].replace(/[\r\n]/g, '').replace(/--$/, '');
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(big.length);
    expect(decoded[123456]).toBe(123456 % 251);
  });

  it('rejects a CRLF-injecting or empty mimeType, falling back to octet-stream', () => {
    const raw = buildMime({
      from: 'a@itdev.gr',
      to: 'c@x.gr',
      subject: 'Hi',
      html: '<p>hi</p>',
      attachments: [
        { filename: 'a.png', mimeType: 'image/png\r\nX-Injected: evil', base64: btoa('x') },
        { filename: 'b.bin', mimeType: '', base64: btoa('y') },
      ],
    });
    const mime = decodeMime(raw);
    expect(mime).not.toContain('X-Injected');
    expect(mime).toContain('Content-Type: application/octet-stream; name="a.png"');
    expect(mime).toContain('Content-Type: application/octet-stream; name="b.bin"');
    // no malformed empty Content-Type
    expect(mime).not.toContain('Content-Type: ; name=');
  });
});
