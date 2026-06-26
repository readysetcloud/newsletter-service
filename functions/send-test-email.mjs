import { handler as parseMarkdown } from './parse-md-to-json.mjs';
import { handler as publishIssue } from './publish-issue.mjs';
import { getOctokit, getTenant } from './utils/helpers.mjs';

/**
 * On-demand test harness for sending a SINGLE newsletter test email.
 *
 * Runs raw markdown through the real parse -> publish (preview) pipeline, so the
 * body shortcodes (e.g. `{{< robotVoice text="..." >}}`) render exactly as they
 * do for a live issue, then sends one `[Preview]` email to the address you
 * supply. It does NOT write an issue record, schedule jobs, touch the
 * subscriber list, or call back to GitHub.
 *
 * Invoke from the Lambda console with a test event:
 *
 *   // Option A - paste raw markdown directly (must include frontmatter):
 *   {
 *     "tenantId": "<tenant>",
 *     "email": "you@example.com",
 *     "content": "---\ntitle: Robot Voice Test\ndate: 2026-06-26\n---\n### A Section\n{{< robotVoice text=\"beep boop, I am a robot\" >}}"
 *   }
 *
 *   // Option B - pull a file straight from the tenant's content repo:
 *   {
 *     "tenantId": "<tenant>",
 *     "email": "you@example.com",
 *     "fileName": "content/newsletter/123.md",
 *     "branchName": "main"
 *   }
 *
 * Optional fields: `issueId` (default 999), `templateId` (default null, which
 * uses the built-in default newsletter template).
 *
 * @param {Object} event
 * @param {string} event.tenantId - Tenant whose snippets/sender/template to use.
 * @param {string} event.email - Single recipient for the test email.
 * @param {string} [event.content] - Raw markdown (with frontmatter). Mutually exclusive with fileName.
 * @param {string} [event.fileName] - Path to a markdown file in the tenant's content repo.
 * @param {string} [event.branchName] - Optional branch/ref for the content-repo fetch.
 * @param {number} [event.issueId=999] - Issue number used for metadata/links.
 * @param {string|null} [event.templateId=null] - Optional tenant template id.
 * @returns {Promise<{sent: boolean, to: string, subject: string, issueId: number}>}
 */
export const handler = async (event) => {
  const { tenantId, email, content, fileName, branchName, issueId = 999, templateId = null } = event ?? {};

  if (!tenantId) throw new Error('tenantId is required');
  if (!email) throw new Error('email is required');
  if (!content && !fileName) {
    throw new Error('Provide either "content" (raw markdown) or "fileName" (path in the content repo)');
  }

  const markdown = content ?? await fetchFromRepo(tenantId, fileName, branchName);

  // Same Lambda code that runs in the StageIssue state machine - this is where
  // the robotVoice shortcode and the rest of the body shortcodes are rendered.
  const parsed = await parseMarkdown({ content: markdown, issueId, tenantId });

  // isPreview: true => single email to `email`, no list send, no scheduling.
  await publishIssue({
    data: parsed.data,
    subject: parsed.subject,
    isPreview: true,
    email,
    tenantId,
    templateId
  });

  console.log(`[TEST EMAIL] Sent preview of "${parsed.subject}" to ${email}`);
  return {
    sent: true,
    to: email,
    subject: `[Preview] ${parsed.subject}`,
    issueId
  };
};

/**
 * Fetch a markdown file from the tenant's configured content repo.
 * @param {string} tenantId - Tenant identifier.
 * @param {string} fileName - Path within the repo (e.g. "content/newsletter/123.md").
 * @param {string} [branchName] - Optional branch/ref; defaults to the repo default branch.
 * @returns {Promise<string>} Raw markdown contents.
 */
const fetchFromRepo = async (tenantId, fileName, branchName) => {
  const tenant = await getTenant(tenantId);
  const octokit = await getOctokit(tenantId);

  const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner: tenant.github.owner,
    repo: tenant.github.repo,
    path: fileName,
    ...branchName && { ref: branchName }
  });

  return Buffer.from(response.data.content, 'base64').toString('utf8');
};
