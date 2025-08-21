
import frontmatter from '@github-docs/frontmatter';
import { getOctokit } from './utils/helpers.mjs';

export const handler = async (state) => {
  try {
    const newsletter = frontmatter(state.content);

    if (!newsletter.data.voting_options && Array.isArray(state.votingOptions) && state.votingOptions.every(vo => vo.id && vo.description)) {
      newsletter.data.voting_options = state.votingOptions;
      if (!newsletter.content.includes('{{<vote>}}')) {
        const lastWordsIndex = newsletter.content.toLowerCase().indexOf('### last words');
        if (lastWordsIndex >= 0) {
          newsletter.content = newsletter.content.substring(0, lastWordsIndex) + '{{<vote>}}\n\n' + newsletter.content.substring(lastWordsIndex);
        }
      }
    }

    if (!state.isPreview) {
      await callbackToTenant(state.fileName, newsletter.content, newsletter.data);
    }

    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false };
  }
};

const callbackToTenant = async (fileName, content, data) => {
  try {
    const octokit = await getOctokit();
    const markdown = frontmatter.stringify(content, data);

    const { data: { sha } } = await octokit.rest.repos.getContent({
      owner: process.env.OWNER,
      repo: process.env.REPO,
      path: fileName,
    });

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: process.env.OWNER,
      repo: process.env.REPO,
      path: fileName,
      message: '[Automated] Updating newsletter with redirects',
      content: Buffer.from(markdown).toString("base64"),
      sha
    });

  } catch (error) {
    console.error('Could not update links with redirects', error.message);
    console.error(error);
  }
};
