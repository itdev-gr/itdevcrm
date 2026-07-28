import { describe, it, expect } from 'vitest';
import { buildZipEntries, type AssetZipInput } from './assetZip';

const empty: AssetZipInput = { logoPath: null, intakeFiles: [], attachmentAreas: [] };

describe('buildZipEntries', () => {
  it('returns [] for empty inputs', () => {
    expect(buildZipEntries(empty)).toEqual([]);
  });

  it('maps the logo into a logo/ folder using the path basename', () => {
    const [entry] = buildZipEntries({
      ...empty,
      logoPath: 'client-intake/job-1/1699999_logo.png',
    });
    expect(entry).toEqual({
      bucket: 'client-intake',
      path: 'client-intake/job-1/1699999_logo.png',
      zipName: 'logo/1699999_logo.png',
    });
  });

  it('maps intake files into client-files/ with the display file_name', () => {
    const entries = buildZipEntries({
      ...empty,
      intakeFiles: [{ storage_path: 'client-intake/job-1/abc', file_name: 'Τιμολόγιο.pdf' }],
    });
    expect(entries).toEqual([
      {
        bucket: 'client-intake',
        path: 'client-intake/job-1/abc',
        zipName: 'client-files/Τιμολόγιο.pdf',
      },
    ]);
  });

  it('maps attachments into attachments/<area-slug>/ and slugifies labels', () => {
    const entries = buildZipEntries({
      ...empty,
      attachmentAreas: [
        { label: 'Local SEO', files: [{ storage_path: 'attachments/a', file_name: 'photo.jpg' }] },
        { label: 'Social Media', files: [{ storage_path: 'attachments/b', file_name: 'brief.docx' }] },
      ],
    });
    expect(entries.map((e) => e.zipName)).toEqual([
      'attachments/local-seo/photo.jpg',
      'attachments/social-media/brief.docx',
    ]);
    expect(entries.every((e) => e.bucket === 'attachments')).toBe(true);
  });

  it('orders entries logo → intake files → attachments', () => {
    const entries = buildZipEntries({
      logoPath: 'client-intake/job-1/logo.png',
      intakeFiles: [{ storage_path: 'client-intake/job-1/f1', file_name: 'doc.pdf' }],
      attachmentAreas: [
        { label: 'Web Dev', files: [{ storage_path: 'attachments/x', file_name: 'spec.txt' }] },
      ],
    });
    expect(entries.map((e) => e.zipName)).toEqual([
      'logo/logo.png',
      'client-files/doc.pdf',
      'attachments/web-dev/spec.txt',
    ]);
  });

  it('strips path separators and control characters but keeps unicode', () => {
    const entries = buildZipEntries({
      ...empty,
      intakeFiles: [
        { storage_path: 'p1', file_name: 'a/b\\c.pdf' },
        { storage_path: 'p2', file_name: 'Ελληνικά.txt' },
      ],
    });
    expect(entries[0]!.zipName).toBe('client-files/a_b_c.pdf');
    expect(entries[1]!.zipName).toBe('client-files/Ελληνικά.txt');
  });

  it('falls back to "file" when a name has no printable characters', () => {
    const [entry] = buildZipEntries({
      ...empty,
      intakeFiles: [{ storage_path: 'p', file_name: '' }],
    });
    expect(entry!.zipName).toBe('client-files/file');
  });

  it('dedupes identical zip names with " (2)", " (3)" before the extension', () => {
    const entries = buildZipEntries({
      ...empty,
      intakeFiles: [
        { storage_path: 'p1', file_name: 'invoice.pdf' },
        { storage_path: 'p2', file_name: 'invoice.pdf' },
        { storage_path: 'p3', file_name: 'invoice.pdf' },
      ],
    });
    expect(entries.map((e) => e.zipName)).toEqual([
      'client-files/invoice.pdf',
      'client-files/invoice (2).pdf',
      'client-files/invoice (3).pdf',
    ]);
  });

  it('dedupes extension-less names by appending the suffix at the end', () => {
    const entries = buildZipEntries({
      ...empty,
      intakeFiles: [
        { storage_path: 'p1', file_name: 'README' },
        { storage_path: 'p2', file_name: 'README' },
      ],
    });
    expect(entries.map((e) => e.zipName)).toEqual([
      'client-files/README',
      'client-files/README (2)',
    ]);
  });

  it('does not collide a generated suffix with a pre-existing suffixed name', () => {
    const entries = buildZipEntries({
      ...empty,
      intakeFiles: [
        { storage_path: 'p1', file_name: 'a.pdf' },
        { storage_path: 'p2', file_name: 'a (2).pdf' },
        { storage_path: 'p3', file_name: 'a.pdf' },
      ],
    });
    expect(entries.map((e) => e.zipName)).toEqual([
      'client-files/a.pdf',
      'client-files/a (2).pdf',
      'client-files/a (3).pdf',
    ]);
  });
});
