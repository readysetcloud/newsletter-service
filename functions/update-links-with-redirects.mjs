export const handler = async (state) => {
  let content = state.content;
  for (const redirect of state.redirects) {
    content = content.replace(redirect.link, `${process.env.REDIRECT_URL}/${redirect.key}${state.addRef ? '?ref=__EMAIL_HASH__' : ''}`);
  }

  return { content };
};
