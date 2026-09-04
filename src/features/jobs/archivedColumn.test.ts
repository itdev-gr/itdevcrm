import { describe, it, expect } from 'vitest';
import { showArchivedColumn } from './archivedColumn';

describe('showArchivedColumn', () => {
  it('οι μη-admin δεν βλέπουν ποτέ τη στήλη, ακόμη κι αν υπάρχουν αρχειοθετημένα', () => {
    expect(showArchivedColumn(false, [{ archived: true }])).toBe(false);
  });

  it('ο admin τη βλέπει όταν υπάρχει έστω ένα αρχειοθετημένο', () => {
    expect(showArchivedColumn(true, [{ archived: true }])).toBe(true);
  });

  it('ο admin δεν τη βλέπει σε άδειο board — καμία κενή στήλη χωρίς λόγο', () => {
    expect(showArchivedColumn(true, [])).toBe(false);
    expect(showArchivedColumn(true, [{ archived: false }])).toBe(false);
  });
});
