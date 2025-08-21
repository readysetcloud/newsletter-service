import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import frontmatter from '@github-docs/frontmatter';
import { getOctokit, getTenant } from './utils/helpers.mjs';
import { publishIssueEvent, EVENT_TYPES } from './utils/event-publisher.mjs';

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
      key: `${tenant.pk}#${github.fileName}`,
      isPreview: process.env.IS_PREVIEW === true || process.env.IS_PREVIEW === 'true',
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
  let postDate = metadata.data.date;
  if (postDate.toISOString().indexOf('T00:00:00.000Z') > -1) {
    postDate = `${postDate.toISOString().split('T')[0]}T12:00:00Z`;
  }

  const date = new Date(postDate);
  if (date > today) {
    data.futureDate = `${metadata.data.date.toISOString().split('T')[0]}T12:00:00Z`;
  }

  const match = metadata.data.slug.match(/\d+/);
  data.issueId = Number(match[0])
  
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
      slug: metadata.data.slug,
      scheduledDate: date > today ? date.toISOString() : null,
      isPreview: data.isPreview,
      metadata: metadata.data
    }
  );
};
