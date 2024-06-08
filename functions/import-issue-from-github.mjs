import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import frontmatter from '@github-docs/frontmatter';
import { getOctokit, getTenant } from './utils/helpers.mjs';

const sfn = new SFNClient();
let octokit;

export const handler = async (event) => {
  try {

    const { github, tenantId, isPreview, email } = event.detail;
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
      ...(isPreview === true) && { isPreview: true, email }
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

  await sfn.send(new StartExecutionCommand({
    stateMachineArn: process.env.STATE_MACHINE_ARN,
    input: JSON.stringify(data)
  }));
};
