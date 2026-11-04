/**
 * Recognizes names produced by a signup bot's random string generator.
 *
 * Measured against the 2026-11-02 rescreen of all 4,241 subscribers. 1,475 of
 * them carry a name of two tokens, each exactly ten characters: 2,852 tokens,
 * not one of any other length. The characters differ every time — 1,475
 * distinct shapes — but the structure never does, which no population of
 * human names reproduces. None predates 24 Jun 2026, against 422 named
 * signups before it; the volume is 462 in September, 974 in October. They
 * engage at 14.8% where ordinary names engage at 47.7%, and their domains are
 * German freemail and Yahoo/Hotmail/AOL, with gmail at 4.6% against 46% for
 * everyone else. It is one source.
 *
 * Every existing deterministic flag missed all 1,475. `honeypotTriggered`,
 * `suspiciousUserAgent` and `unknownIp` have never fired in the table's
 * history; `fastSubmission` and `suspiciousEmailPattern` have fired 867 times
 * between them without catching a single one of these. This runs on the
 * sanitized name, so it sees exactly what would have been stored.
 *
 * Why not entropy, which is the obvious reading of "random-looking":
 *
 *   - Scored against real-world names, a combination of low vowel ratio,
 *     consonant runs and case switches flags 23% of them. Polish, Dutch,
 *     Scandinavian, Irish and Scottish orthography is not high-entropy noise.
 *   - 445 subscribers on this very list have names that are single random
 *     tokens of 16-24 characters, from February to July, when that source
 *     stopped. They engage at 46.5% — indistinguishable from ordinary names.
 *     They are real readers, and an entropy rule blocks them.
 *
 * So this matches a signature, not a quality. It is deliberately narrow and
 * it is brittle by construction: the operator changes one constant and it
 * stops working, with no error to say so. It buys time for a control that
 * does not depend on what the client chooses to send.
 *
 * Tuning, on the same data: 1,451 of 1,475 caught (98.4%), 0 of the other
 * 1,030 named subscribers, 0 of a hand-built control that includes the names
 * bare length would have caught (Alexandria Washington, Konstantin
 * Zhelyazkov) and the internal-capital surnames a single case switch would
 * have caught (DeSantiago, DiGiovanni, MacGregors, McCormicks).
 */

/** Shortest token that may be judged on mixing letters with digits. */
const MIXED_TOKEN_LENGTH = 8;

/** The generator's token length, as observed across all 2,852 of them. */
const GENERATED_TOKEN_LENGTH = 10;

/**
 * Lowercase-to-uppercase transitions inside one token before it reads as
 * scrambled rather than spelled.
 *
 * Three, because fewer convicts real surnames: `DeSantiago` and `MacGregors`
 * have one, `VanDerWall` has two, and a capital at a morpheme boundary is how
 * those names are written. A ten-character random string averages more and
 * scatters them. The cost is the 24 bot rows with no digit and a flatter case
 * pattern, which this deliberately lets through rather than reach for them.
 */
const MIN_CASE_SWITCHES = 3;

const tokensOf = (...parts) => parts
  .filter(part => typeof part === 'string')
  .flatMap(part => part.split(/\s+/))
  .filter(Boolean);

/**
 * A long token carrying both letters and digits.
 *
 * Length-independent, so it still holds if the generator changes its token
 * size, and it is the clause doing most of the work: 1,426 of the 1,475.
 * The length floor is what keeps a human out of it — someone signing as
 * `Allen Helton 2` has a one-character digit token, not an eight-character
 * mixed one.
 */
const mixesLettersAndDigits = (token) =>
  token.length >= MIXED_TOKEN_LENGTH && /[A-Za-z]/.test(token) && /\d/.test(token);

const caseSwitches = (token) => (token.match(/[a-z][A-Z]/g) || []).length;

/**
 * Whether a submitted name looks machine-generated.
 *
 * Takes the name parts as stored. Absent or non-string parts are ignored
 * rather than treated as evidence: a signup with no name at all is ordinary,
 * and 1,736 subscribers on this list have none.
 *
 * @param {...*} parts - Name fields, normally firstName and lastName
 * @returns {boolean} true when the name matches the generator's signature
 */
export function isGeneratedName(...parts) {
  const tokens = tokensOf(...parts);
  if (!tokens.length) return false;

  if (tokens.some(mixesLettersAndDigits)) return true;

  // The all-letter variant. Only the exact observed shape, because without a
  // digit to anchor it this is the clause that could reach a real name.
  return tokens.length === 2
    && tokens.every((token) => token.length === GENERATED_TOKEN_LENGTH)
    && tokens.some((token) => caseSwitches(token) >= MIN_CASE_SWITCHES);
}
