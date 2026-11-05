import { describe, test, expect } from '@jest/globals';
import { isGeneratedName } from '../utils/generated-name.mjs';

// Shapes, not captured records. The real cohort's names are tied to real
// addresses, and nothing here needs the actual strings to make the point.
describe('isGeneratedName', () => {
  describe('catches the generator', () => {
    // The dominant clause: a long token mixing letters and digits, which is
    // 1,426 of the 1,475 observed rows.
    test.each([
      ['c5QdWQH7gz', 'l2uZduTOGW'],
      ['NMy6Aq5qdX', 'S7hbK2pWqz'],
      ['bk75jFI6UI', 'qVoCx3mTzb'],
      ['J7hyM1jDy9', 'EX3fnQsLvA']
    ])('two mixed alphanumeric tokens: %s %s', (first, last) => {
      expect(isGeneratedName(first, last)).toBe(true);
    });

    // The all-letter variant, which only the exact 10+10 shape reaches.
    test('two ten-letter tokens with a scattered case pattern', () => {
      expect(isGeneratedName('aXbYcZdWeV', 'mNoPqRsTuV')).toBe(true);
    });

    // The generator's token length is not load-bearing for the digit clause,
    // so a change to it does not silently disable the whole rule.
    test('still catches a mixed token at a different length', () => {
      expect(isGeneratedName('a1B2c3D4e5F6g7', 'H8i9J0k1L2m3n4')).toBe(true);
    });

    test('one of the two tokens carrying digits is enough, either side', () => {
      expect(isGeneratedName('Michael', 'x7Kq2Lp9Rt')).toBe(true);
      expect(isGeneratedName('x7Kq2Lp9Rt', 'Michael')).toBe(true);
    });
  });

  describe('leaves real names alone', () => {
    test.each([
      'Allen Helton',
      'Maria Garcia',
      'Krzysztof Wojcik',
      'Grzegorz Brzeczyszczykiewicz',
      'Oluwaseun Adeyemi',
      'Hiroshi Yamamoto',
      'Bjorn Borg'
    ])('ordinary name: %s', (name) => {
      const [first, ...rest] = name.split(' ');
      expect(isGeneratedName(first, rest.join(' '))).toBe(false);
    });

    // Exactly ten and ten, which is why length alone cannot be the rule.
    test.each([
      ['Alexandria', 'Washington'],
      ['Konstantin', 'Zhelyazkov'],
      ['Anastasiya', 'Kuznetsova']
    ])('real name that happens to be 10+10: %s %s', (first, last) => {
      expect(isGeneratedName(first, last)).toBe(false);
    });

    // A capital inside a surname is orthography, not noise. These are 10+10
    // with one or two case switches, which is why the threshold is three.
    test.each([
      ['Bernadette', 'DeSantiago'],
      ['Alessandro', 'DiGiovanni'],
      ['Maximilian', 'MacGregors'],
      ['Jacqueline', 'McCormicks'],
      ['Wilhelmina', 'VanDerWall']
    ])('internal-capital surname: %s %s', (first, last) => {
      expect(isGeneratedName(first, last)).toBe(false);
    });

    // The 416 subscribers whose names are two long random tokens engage at
    // 57.7%, above ordinary names. An entropy rule blocks them; this must
    // not.
    test('a long opaque token is not evidence by itself', () => {
      expect(isGeneratedName('AaaAaaAAaaaaaAAaAAaA', 'AaaaAAaaaaaaaaaaAaa')).toBe(false);
    });

    test('a digit typed as its own short token', () => {
      expect(isGeneratedName('Allen', 'Helton 2')).toBe(false);
    });

    test('a short handle with digits', () => {
      expect(isGeneratedName('R2D2', 'Unit')).toBe(false);
    });

    // A handle is what a reader types when the form asks for a name and they
    // would rather not give one. Mixed letters and digits, over the length
    // floor, and not this bot: the generator has never emitted one token, and
    // no subscriber on the list carries a single mixed one.
    test.each([
      'allenh1985',
      'sarah2024dev',
      'mcdonald99',
      'xXgamer2026Xx'
    ])('a lone handle-shaped value is allowed: %s', (handle) => {
      expect(isGeneratedName(handle, undefined)).toBe(false);
      expect(isGeneratedName(handle, '')).toBe(false);
    });

    test('a mixed token among three is not the generator either', () => {
      expect(isGeneratedName('Allen', 'J Helton1985')).toBe(false);
      expect(isGeneratedName('x7Kq2Lp9Rt', 'l2uZduTOGW qVoCx3mTzb')).toBe(false);
    });
  });

  describe('absent and malformed input', () => {
    test.each([
      ['both missing', [undefined, undefined]],
      ['empty strings', ['', '']],
      ['whitespace only', ['   ', '\t']],
      ['non-string values', [{ first: 'x' }, 42]],
      ['null', [null, null]],
      ['no arguments', []]
    ])('%s is not a generated name', (_label, parts) => {
      expect(isGeneratedName(...parts)).toBe(false);
    });

    // 1,736 subscribers have no name at all, and they engage at the highest
    // rate on the list. Absence must never be read as evidence.
    test('a one-token name is never a match', () => {
      expect(isGeneratedName('Allen', undefined)).toBe(false);
      expect(isGeneratedName('x7Kq2Lp9Rt', undefined)).toBe(false);
      expect(isGeneratedName(undefined, 'x7Kq2Lp9Rt')).toBe(false);
    });
  });
});
