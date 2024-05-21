export const handler = async (state) => {
  let content = state.content;
  for (const redirect of state.redirects) {
    content = content.replace(redirect.link, `${process.env.REDIRECT_URL}/${redirect.key}`);
  }

  return { content };
};
