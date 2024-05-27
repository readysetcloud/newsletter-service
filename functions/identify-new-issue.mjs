import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import frontmatter from '@github-docs/frontmatter';
import { getOctokit } from './utils/helpers.mjs';

const sfn = new SFNClient();
const eventBridge = new EventBridgeClient();
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
        const data = await getContentData(newContent);
        await processNewContent(data);
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

const getContentData = async (newContent) => {
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

const processNewContent = async (newContent) => {
  const today = new Date();
  const executions = await Promise.allSettled(newContent.map(async (content) => {
    const metadata = frontmatter(content.content);
    let postDate = metadata.data.date;
    if(!postDate.includes('T')){
      postDate = `${postDate}T23:59:59`;
    }
    const date = new Date(metadata.data.date);
    if (date > today) {
      await scheduleFuturePost(content, metadata.data.date);
    } else {
      await processContentNow(content);
    }
  }));

  for (const execution of executions) {
    if (execution.status == 'rejected') {
      console.error(execution.reason);
    }
  }
};

const scheduleFuturePost = async (content, date) => {
  await eventBridge.send(new PutEventsCommand({
    Entries: [
      {
        Source: 'rsc.identify-new-content',
        DetailType: 'Schedule Post',
        Detail: JSON.stringify({
          fileName: content.fileName,
          commit: content.commit,
          date: date,
          type: 'newsletter'
        })
      }
    ]
  }
  ));
};

const processContentNow = async (content) => {
  await sfn.send(new StartExecutionCommand({
    stateMachineArn: process.env.STATE_MACHINE_ARN,
    input: JSON.stringify(content)
  }));
};
