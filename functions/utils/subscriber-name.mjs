/**
 * Normalization for subscriber-supplied names.
 *
 * The public signup endpoint is unauthenticated and validates only the email
 * address, so `firstName` and `lastName` arrive as arbitrary JSON: any type,
 * any length. Whatever lands in the record is later rendered into the welcome
 * email and the dashboard subscriber list.
 */

/**
 * Longest name kept, in characters.
 *
 * Matches the cap the authenticated profile endpoint already declares
 * (`openapi.yaml`, maxLength 50) so the two paths agree on what a name is.
 */
export const MAX_NAME_LENGTH = 50;

/**
 * Code point ranges stripped before storage, as [first, last] inclusive pairs.
 *
 * Expressed as numbers rather than a character class because the literal
 * characters are invisible in a source file, which makes the intent of the
 * pattern impossible to review.
 *
 *   C0 controls and DEL, C1 controls  — render as nothing or as layout damage
 *   zero-width and directional marks  — invisible, and can reorder display
 *   line/paragraph separators, bidi   — can make stored text display as
 *   overrides, invisible operators      something other than what it is
 *   byte order mark                   — stray from copy-paste
 */
const STRIPPED_RANGES = [
  // Tab through carriage return (0x09-0x0d) are deliberately absent: they are
  // whitespace, and a name submitted across two lines reads correctly once the
  // collapse below turns them into a single space. Removing them outright
  // would run the words together.
  [0x0000, 0x0008],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff]
];

const isStripped = (codePoint) =>
  STRIPPED_RANGES.some(([first, last]) => codePoint >= first && codePoint <= last);

/**
 * Reduce a submitted name to something safe to store and display, or null if
 * there is nothing usable left.
 *
 * Over-length names are truncated rather than rejected. The profile endpoint
 * returns a 400 for the same input, and the inconsistency is deliberate: that
 * endpoint is a logged-in user editing their own record who can see the error
 * and fix it, whereas this one is a public signup where the reader is the
 * person who loses out if a long name costs them the subscription. Capping the
 * stored value gets the unbounded write under control without that cost.
 *
 * @param {*} value - Raw value from the request body, any type
 * @returns {string|null} Normalized name, or null when absent/unusable
 */
export function sanitizeName(value) {
  // Anything non-string (object, array, number, null) is not a name. Silently
  // dropping it is right for a field that was always optional.
  if (typeof value !== 'string') return null;

  // Iterating the string spreads it into whole code points, so an astral
  // character is never split into a lone surrogate half.
  const kept = [...value].filter((char) => !isStripped(char.codePointAt(0)));

  const cleaned = kept
    .join('')
    // Collapse runs of whitespace so a name padded out to the cap cannot push
    // the visible part out of a list column.
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) return null;

  return [...cleaned].slice(0, MAX_NAME_LENGTH).join('');
}
