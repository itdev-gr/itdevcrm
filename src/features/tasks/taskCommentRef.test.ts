import { describe, it, expect } from 'vitest';
import { parseTaskKey } from './taskCommentRef';

const UUID = '0d3a4f21-9bcd-4bf5-b09b-0ccb7341a7ad';

describe('parseTaskKey', () => {
  it('parses assigned and user keys', () => {
    expect(parseTaskKey(`assigned:${UUID}`)).toEqual({ kind: 'assigned', id: UUID });
    expect(parseTaskKey(`user:${UUID}`)).toEqual({ kind: 'user', id: UUID });
  });
  it('rejects malformed keys', () => {
    expect(parseTaskKey(null)).toBeNull();
    expect(parseTaskKey('')).toBeNull();
    expect(parseTaskKey('task:123')).toBeNull();
    expect(parseTaskKey(`assigned:not-a-uuid`)).toBeNull();
    expect(parseTaskKey(UUID)).toBeNull();
  });
});
