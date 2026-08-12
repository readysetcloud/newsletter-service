import { sanitizeName, MAX_NAME_LENGTH } from '../utils/subscriber-name.mjs';

/** Build a string from a code point, keeping literal control chars out of source. */
const ch = (codePoint) => String.fromCodePoint(codePoint);

describe('sanitizeName', () => {
  describe('absent or unusable input', () => {
    it('returns null for anything that is not a string', () => {
      for (const value of [undefined, null, 42, true, {}, [], { toString: () => 'Ada' }]) {
        expect(sanitizeName(value)).toBeNull();
      }
    });

    it('returns null for a string with nothing visible in it', () => {
      expect(sanitizeName('')).toBeNull();
      expect(sanitizeName('   ')).toBeNull();
      expect(sanitizeName(ch(0x200b) + ch(0x200b))).toBeNull();
      expect(sanitizeName(ch(0x09) + ch(0x0a))).toBeNull();
    });
  });

  describe('normalization', () => {
    it('trims and collapses whitespace', () => {
      expect(sanitizeName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    });

    it('turns line breaks and tabs into a single space rather than joining words', () => {
      expect(sanitizeName('Ada' + ch(0x0a) + 'Lovelace')).toBe('Ada Lovelace');
      expect(sanitizeName('Ada' + ch(0x09) + 'Lovelace')).toBe('Ada Lovelace');
      expect(sanitizeName('Ada' + ch(0x0d) + ch(0x0a) + 'Lovelace')).toBe('Ada Lovelace');
    });

    it('removes control characters outright', () => {
      expect(sanitizeName('Ada' + ch(0x00) + ' Lovelace')).toBe('Ada Lovelace');
      expect(sanitizeName('Ada' + ch(0x1b) + ' Lovelace')).toBe('Ada Lovelace');
      expect(sanitizeName('Ada' + ch(0x7f) + ' Lovelace')).toBe('Ada Lovelace');
    });

    it('removes zero-width characters used to disguise a word', () => {
      // "ad<zero-width space>min" displays as "admin" but stores as something
      // that evades an equality check.
      expect(sanitizeName('ad' + ch(0x200b) + 'min')).toBe('admin');
      expect(sanitizeName('a' + ch(0xfeff) + 'b')).toBe('ab');
    });

    it('removes bidirectional overrides', () => {
      expect(sanitizeName('Ada' + ch(0x202e) + 'Lovelace')).toBe('AdaLovelace');
    });

    it('leaves ordinary international names untouched', () => {
      for (const name of ['José', 'Ægir', 'Łukasz', '田中', 'Разумовский', "O'Brien", 'Anne-Marie']) {
        expect(sanitizeName(name)).toBe(name);
      }
    });
  });

  describe('length', () => {
    it('truncates rather than rejecting', () => {
      const long = 'A'.repeat(MAX_NAME_LENGTH + 30);
      expect(sanitizeName(long)).toHaveLength(MAX_NAME_LENGTH);
    });

    it('keeps a name exactly at the cap', () => {
      const exact = 'A'.repeat(MAX_NAME_LENGTH);
      expect(sanitizeName(exact)).toBe(exact);
    });

    it('counts code points, not UTF-16 units, so astral characters stay whole', () => {
      const emoji = '👩';
      const result = sanitizeName(emoji.repeat(MAX_NAME_LENGTH + 10));

      expect([...result]).toHaveLength(MAX_NAME_LENGTH);
      // Emoji are surrogate *pairs*, which are fine; what a mid-code-point
      // slice would leave behind is an unpaired half.
      const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
      expect(result).not.toMatch(loneSurrogate);
    });

    it('measures length after cleaning, not before', () => {
      // Padding with spaces must not consume the budget for real characters.
      const padded = '  ' + 'A'.repeat(MAX_NAME_LENGTH) + '  ';
      expect(sanitizeName(padded)).toHaveLength(MAX_NAME_LENGTH);
    });
  });
});
