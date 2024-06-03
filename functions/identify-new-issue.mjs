import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import frontmatter from '@github-docs/frontmatter';
import { getOctokit } from './utils/helpers.mjs';

const sfn = new SFNClient();
let octokit;

export const handler = async (event) => {
  try {
    octokit = await getOctokit();
    const recentCommits = await getRecentCommits();
    if (event.commits) {
      event.commits.map(c => recentCommits.push(c));
    }
    if (recentCommits.length) {
      const newContent = await getNewContent(recentCommits);
      if (newContent.length) {
        const data = await getIssueData(newContent);
        await processNewIssue(data);
      }
    }
  } catch (err) {
    console.error(err);
  }
};

const getRecentCommits = async () => {
  const timeTolerance = Number(process.env.COMMIT_TIME_TOLERANCE_MINUTES);
  const date = new Date();
  date.setMinutes(date.getMinutes() - timeTolerance);

  const result = await octokit.rest.repos.listCommits({
    owner: process.env.OWNER,
    repo: process.env.REPO,
    path: 'content/newsletter',
    since: date.toISOString()
  });

  const newPostCommits = result.data.filter(c => c.commit.message.toLowerCase().startsWith('[newsletter]'));
  return newPostCommits.map(d => d.sha);
};

const getNewContent = async (commits) => {
  const newContent = await Promise.allSettled(commits.map(async (commit) => {
    const commitDetail = await octokit.rest.repos.getCommit({
      owner: process.env.OWNER,
      repo: process.env.REPO,
      ref: commit
    });
    const newFiles = commitDetail.data.files.filter(f => ['added', 'renamed']
      .includes(f.status) && f.filename.startsWith('content/newsletter/'));

    return newFiles.map(p => {
      return {
        fileName: p.filename,
        commit: commit
      };
    });
  }));

  let content = [];
  for (const result of newContent) {
    if (result.status == 'rejected') {
      console.error(result.reason);
    } else {
      content = [...content, ...result.value];
    }
  }

  return content;
};

const getIssueData = async (newContent) => {
  const contentData = await Promise.allSettled(newContent.map(async (content) => {
    const postContent = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: process.env.OWNER,
      repo: process.env.REPO,
      path: content.fileName
    });

    const buffer = Buffer.from(postContent.data.content, 'base64');
    const data = buffer.toString('utf8');

    return {
      fileName: content.fileName,
      commit: content.commit,
      content: data
    };
  }));

  let allContent = [];
  for (const result of contentData) {
    if (result.status == 'rejected') {
      console.error(result.reason);
    } else {
      allContent.push(result.value);
    }
  }

  return allContent;
};

const processNewIssue = async (newContent) => {
  const today = new Date();
  const executions = await Promise.allSettled(newContent.map(async (content) => {
    const metadata = frontmatter(content.content);
    let postDate = metadata.data.date;
    if (postDate.toISOString().indexOf('T00:00:00.000Z') > -1) {
      postDate = `${postDate.toISOString().split('T')[0]}T12:00:00Z`;
    }

    const date = new Date(postDate);
    if (date > today) {
      content.futureDate = `${metadata.data.date.toISOString().split('T')[0]}T12:00:00Z`;
    }

    await sfn.send(new StartExecutionCommand({
      stateMachineArn: process.env.STATE_MACHINE_ARN,
      input: JSON.stringify(content)
    }));
  }));

  for (const execution of executions) {
    if (execution.status == 'rejected') {
      console.error(execution.reason);
    }
  }
};
