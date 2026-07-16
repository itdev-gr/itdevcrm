import { describe, it, expect } from 'vitest';
import { resolveMentionedUserIds, mentionTokenMatcher } from './comment-utils';

// `users` list shape mirrors CommentForm (MentionableUser: { user_id, full_name, ... }).
const users = [
  { user_id: 'u-full', full_name: 'Full Name' },
  { user_id: 'u-a', full_name: 'A' },
  { user_id: 'u-b', full_name: 'B' },
  { user_id: 'u-nikos', full_name: 'Nikos' },
  { user_id: 'u-greek', full_name: 'Νίκος Παπαδόπουλος' },
];

const resolve = (text: string) => resolveMentionedUserIds(text, users).sort();

describe('resolveMentionedUserIds — highlight must imply notify', () => {
  it("resolves `@Full_Name's reply` (trailing apostrophe)", () => {
    expect(resolve("@Full_Name's reply")).toEqual(['u-full']);
  });

  it('resolves both halves of `@A/@B` (slash separator, no leading space)', () => {
    expect(resolve('@A/@B')).toEqual(['u-a', 'u-b'].sort());
  });

  it('does NOT resolve `@Nikos` inside `@Nikosxyz` (letter continuation)', () => {
    expect(resolve('@Nikosxyz')).toEqual([]);
  });

  it('still resolves a normal `@Full_Name.` (trailing dot)', () => {
    expect(resolve('@Full_Name.')).toEqual(['u-full']);
  });

  it('resolves `@Name(x)` and mid-sentence mentions', () => {
    expect(resolve('ping @Full_Name(urgent) now')).toEqual(['u-full']);
  });

  it('resolves Greek-letter names with trailing punctuation', () => {
    expect(resolveMentionedUserIds('γεια @Νίκος_Παπαδόπουλος!', users)).toEqual(['u-greek']);
  });

  it('does not resolve a plain word without `@`', () => {
    expect(resolve('Full_Name said hi')).toEqual([]);
  });

  it('honours session tokens exactly (case-sensitive) with the same boundary rules', () => {
    const session = new Map([['@Full_Name', 'u-full']]);
    expect(resolveMentionedUserIds("@Full_Name's", [], session)).toEqual(['u-full']);
    expect(resolveMentionedUserIds('@Full_Namexyz', [], session)).toEqual([]);
  });
});

describe('mentionTokenMatcher boundary parity with the highlighter', () => {
  it('matches on non-word boundaries but not on letter/digit continuation', () => {
    expect(mentionTokenMatcher('@A').test('@A/@B')).toBe(true);
    expect(mentionTokenMatcher('@Nikos').test('@Nikosxyz')).toBe(false);
    expect(mentionTokenMatcher('@Full_Name').test('@Full_Name.')).toBe(true);
  });
});
