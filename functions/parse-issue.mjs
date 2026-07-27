/**
 * Single entry point for parsing an issue, whatever its content type.
 *
 * The state machine used to branch on `contentType` and run one of two
 * near-duplicate tails, one per parser. This dispatcher lets it run a single
 * `Parse Issue` Task instead (Phase 3 of docs/stage-issue-simplification-plan.md)
 * by choosing the parser here rather than in ASL.
 *
 * It contains no parsing logic of its own, deliberately. Both parsers already
 * return the identical contract:
 *
 *   { data, sendAtDate, listCleanupDate, reportStatsDate, subject }
 *
 * and `listCleanupDate` / `reportStatsDate` become EventBridge Scheduler entries
 * that fire three and five days after the send — a value that is off by a second
 * or a day mis-fires a job days later with nothing watching it. So the delegate's
 * return value is handed back verbatim: no re-shaping, no field picking, no
 * re-deriving a date the parser already computed.
 */
import { handler as parseMarkdown } from './parse-md-to-json.mjs';
import { handler as parseJsonIssue } from './parse-json-issue.mjs';

const CONTENT_TYPE_MARKDOWN = 'markdown';

// Content types the json parser owns. Everything else — absent, empty, unknown —
// is markdown, matching `normalize_content_type` in
// functions/src/api/controllers/issues.rs, which is what stamps the value onto
// the issue record in the first place. The two must agree: an issue the API
// recorded as json has its `content` stored as a JSON string, and running that
// through the markdown parser would produce an issue full of literal JSON.
const JSON_PARSER_CONTENT_TYPES = new Set(['json', 'html']);

const normalizeContentType = (value) =>
  typeof value === 'string' && JSON_PARSER_CONTENT_TYPES.has(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : CONTENT_TYPE_MARKDOWN;

export const handler = async (state) => {
  const contentType = normalizeContentType(state?.contentType);
  const delegate = contentType === CONTENT_TYPE_MARKDOWN ? parseMarkdown : parseJsonIssue;

  // The delegate sees the *normalized* contentType, not the caller's raw value:
  // parse-json-issue separates html from json with an exact `=== 'html'` check,
  // so `HTML` would otherwise fall through to `JSON.parse` on a pre-rendered
  // email master. Every other field is forwarded untouched — each parser reads
  // what it needs and ignores the rest.
  return delegate({ ...state, contentType });
};
