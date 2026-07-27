import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import frontmatter from '@github-docs/frontmatter';
import { getOctokit, getTenant } from './utils/helpers.mjs';
import { publishIssueEvent, EVENT_TYPES } from './utils/event-publisher.mjs';
import { getTenantSettings, resolveSendInstant } from './utils/tenant-settings.mjs';

const sfn = new SFNClient();
let octokit;

export const handler = async (event) => {
  try {
    const { github, tenantId, email } = event.detail;
    const tenant = await getTenant(tenantId);
    octokit = await getOctokit(tenantId);

    const data = await getIssueData(tenant, github);
    const issueData = {
      content: data,
      fileName: github.fileName,
      tenant: {
        id: tenant.pk,
        email: tenant.email
      },
      // Inert since Phase 2 of docs/stage-issue-simplification-plan.md deleted
      // the state machine's preview states: nothing reads this field any more,
      // so a non-production import runs the real publish path and really sends.
      // Kept rather than dropped because removing it would make the state
      // machine's loss of preview support invisible, and it is not this file's
      // call to make - see the IS_PREVIEW comment in template.yaml.
      isPreview: process.env.IS_PREVIEW === true || process.env.IS_PREVIEW === 'true',
      // Always present (null when no template selected) so the state machine can
      // reference it unconditionally; GitHub-imported issues use the default template.
      templateId: null,
      // Same reason: the state machine forwards `subject` to the markdown
      // parser with a `.$` path reference, which fails the execution outright
      // if the field is absent. Null means "no caller subject", so the parser
      // falls back to the tenant's subjectTemplate.
      subject: null,
      ...email && { email }
    };
    await processNewIssue(issueData);

  } catch (err) {
    console.error(err);
  }
};

const getIssueData = async (tenant, github) => {
  const postContent = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner: tenant.github.owner,
    repo: tenant.github.repo,
    path: github.fileName,
    ...github.branchName && { ref: github.branchName }
  });

  const buffer = Buffer.from(postContent.data.content, 'base64');
  const data = buffer.toString('utf8');

  return data;
};

const processNewIssue = async (data) => {
  const today = new Date();
  const metadata = frontmatter(data.content);

  // A frontmatter `date:` with no time attached (which YAML hands back as UTC
  // midnight) is a day, not a moment. It gets the tenant's configured default
  // send time in the tenant's timezone; a date that already names a time is
  // taken as written.
  const settings = await getTenantSettings(data.tenant.id);
  const date = resolveSendInstant(metadata.data.date, settings);

  if (date && date > today) {
    data.futureDate = date.toISOString();
  }

  const slugSource = (metadata.data.slug || github.slug || '').toString();
  const issueMatch = slugSource.match(/\/(\d+)/);
  if (!issueMatch) {
    throw new Error('Unable to determine issue number from slug');
  }
  data.issueId = Number(issueMatch[1]);
  data.key = `${data.tenant.id}#${data.issueId}`;
  
  await sfn.send(new StartExecutionCommand({
    stateMachineArn: process.env.STATE_MACHINE_ARN,
    input: JSON.stringify(data)
  }));

  // Publish issue draft saved event after starting the processing workflow
  await publishIssueEvent(
    data.tenant.id,
    'github-import', // User ID for GitHub import
    EVENT_TYPES.ISSUE_DRAFT_SAVED,
    {
      issueId: data.key,
      fileName: data.fileName,
      title: metadata.data.title || 'Untitled Issue',
      scheduledDate: date && date > today ? date.toISOString() : null,
      isPreview: data.isPreview,
      metadata: metadata.data
    }
  );
};
