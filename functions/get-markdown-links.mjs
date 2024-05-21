export const handler = async (state) => {
  const linkRegex = /\[.*?\]\((.*?)\)/g;
  let matches;
  const links = [];

  while ((matches = linkRegex.exec(state.content)) !== null) {
    // Avoid infinite loops with zero-width matches
    if (matches.index === linkRegex.lastIndex) {
      linkRegex.lastIndex++;
    }

    if (matches[1] && matches[1].indexOf('mailto:') === -1) {
      links.push(matches[1]);
    }
  }

  return { links };
};
