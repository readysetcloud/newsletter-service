import { handler as parseMarkdown } from './parse-md-to-json.mjs';
import { handler as publishIssue } from './publish-issue.mjs';

/**
 * On-demand test harness for sending a SINGLE newsletter test email.
 *
 * Runs raw markdown through the real parse -> publish (preview) pipeline, so the
 * body shortcodes (e.g. `{{< robotVoice text="..." >}}`) render exactly as they
 * do for a live issue, then sends one `[Preview]` email to the address you
 * supply. It does NOT write an issue record, schedule jobs, touch the
 * subscriber list, or call back to GitHub.
 *
 * Invoke from the Lambda console with a test event. The markdown is pasted in
 * directly and must carry the usual frontmatter:
 *
 *   {
 *     "tenantId": "<tenant>",
 *     "email": "you@example.com",
 *     "templateId": "<one of the tenant's template ids>",
 *     "content": "---\ntitle: Robot Voice Test\ndate: 2026-06-26\n---\n### A Section\n{{< robotVoice text=\"beep boop, I am a robot\" >}}"
 *   }
 *
 * This used to accept a `fileName` instead, and fetch that path out of the
 * tenant's GitHub content repo. That path is gone: it was the last caller that
 * needed a *per-tenant* GitHub credential, and issues have reached the platform
 * through the API rather than through a repo since the cutover. Paste the
 * markdown, or read it out of the issue record.
 *
 * `templateId` is required: there is no built-in default layout any more, so a
 * test email has to render through one of the tenant's templates - which is
 * also the point, since a test that rendered through something the real send
 * would never use is not a test of the real send.
 *
 * Optional fields: `issueId` (default 999).
 *
 * @param {Object} event
 * @param {string} event.tenantId - Tenant whose snippets/sender/template to use.
 * @param {string} event.email - Single recipient for the test email.
 * @param {string} event.content - Raw markdown, including the usual frontmatter.
 * @param {number} [event.issueId=999] - Issue number used for metadata/links.
 * @param {string} event.templateId - Tenant template id to render through.
 * @returns {Promise<{sent: boolean, to: string, subject: string, issueId: number}>}
 */
export const handler = async (event) => {
  const { tenantId, email, content, issueId = 999, templateId } = event ?? {};

  if (!tenantId) throw new Error('tenantId is required');
  if (!email) throw new Error('email is required');
  if (!templateId) throw new Error('templateId is required');
  if (!content) throw new Error('content is required');

  // Same Lambda code that runs in the StageIssue state machine - this is where
  // the robotVoice shortcode and the rest of the body shortcodes are rendered.
  const parsed = await parseMarkdown({ content, issueId, tenantId });

  // isPreview: true => single email to `email`, no list send, no scheduling.
  const published = await publishIssue({
    data: parsed.data,
    subject: parsed.subject,
    isPreview: true,
    email,
    tenantId,
    templateId
  });

  // publish-issue reports a render or send failure as `success: false` rather
  // than throwing (the state machine reads it as a Choice). Without this check
  // a template that does not exist would log "Sent preview" and return
  // `sent: true` for an email nobody received.
  if (!published?.success) {
    throw new Error(`Failed to publish test email for tenant '${tenantId}' (template '${templateId}') - see the publish-issue logs`);
  }

  console.log(`[TEST EMAIL] Sent preview of "${parsed.subject}" to ${email}`);
  return {
    sent: true,
    to: email,
    subject: `[Preview] ${parsed.subject}`,
    issueId
  };
};
