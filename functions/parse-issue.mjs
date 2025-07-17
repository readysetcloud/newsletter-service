
import showdown from 'showdown';
import frontmatter from '@github-docs/frontmatter';
import { getOctokit } from './utils/helpers.mjs';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();
const converter = new showdown.Converter();

export const handler = async (state) => {
  const newsletter = frontmatter(state.content);
  const sponsor = await getSponsorDetails(newsletter.data.sponsor, newsletter.data.sponsor_description);
  const author = await getAuthor(newsletter.data.author);

  let sections = newsletter.content.split('### ');
  sections = sections.map(s => processSection(s, sponsor));
  sections = sections.filter(ps => ps.header);

  if (sponsor) {
    delete sponsor.ad;
  }

  const newsletterDate = new Date(newsletter.data.date);
  const formattedDate = newsletterDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const dataTemplate = {
    metadata: {
      number: Number(newsletter.data.slug.substring(1)),
      title: newsletter.data.title,
      description: newsletter.data.description,
      date: formattedDate,
      url: `https://readysetcloud.io/newsletter${newsletter.data.slug}`,
      ...(author && { author })
    },
    ...(sponsor && { sponsor }),
    content: {},
    ...state.votingOptions && { votingOptions: state.votingOptions }
  };

  const tipOfTheWeekIndex = sections.findIndex(ps => ps.header.toLowerCase().includes('tip of the week'));
  if (tipOfTheWeekIndex >= 0) {
    let tipOfTheWeek = sections[tipOfTheWeekIndex];
    tipOfTheWeek = processTipOfTheWeek(tipOfTheWeek);
    sections.splice(tipOfTheWeekIndex, 1);
    dataTemplate.content.tipOfTheWeek = tipOfTheWeek;
  }

  const lastWordsIndex = sections.findIndex(ps => ps.header.toLowerCase().includes('last words'));
  if (lastWordsIndex >= 0) {
    let lastWords = sections[lastWordsIndex];
    sections.splice(lastWordsIndex, 1);
    lastWords = convertToHtml(lastWords.raw);

    dataTemplate.content.lastWords = lastWords;
  }

  dataTemplate.content.sections = sections.map(ps => {
    return {
      header: ps.header,
      text: ps.html
    };
  });

  newsletterDate.setHours(14);
  if (!newsletter.data.voting_options && Array.isArray(state.votingOptions) && state.votingOptions.every(vo => vo.id && vo.description)) {
    newsletter.data.voting_options = state.votingOptions;
    if(!newsletter.content.includes('{{<vote>}}')) {
      const lastWordsIndex = newsletter.content.toLowerCase().indexOf('### last words');
      if (lastWordsIndex >= 0) {
        newsletter.content = newsletter.content.substring(0, lastWordsIndex) + '{{<vote>}}\n\n' + newsletter.content.substring(lastWordsIndex);
      }
    }
  }

  if (!state.isPreview) {
    await updateSourceWithRedirects(state.fileName, newsletter.content, newsletter.data);
  }

  const topStatsDate = new Date(newsletterDate);
  topStatsDate.setDate(topStatsDate.getDate() + 3);

  const reportStatsDate = new Date(newsletterDate);
  reportStatsDate.setDate(reportStatsDate.getDate() + 5);

  const now = new Date();
  const sendAtDate = newsletterDate < now ? 'now' : newsletterDate.toISOString();

  return {
    data: dataTemplate,
    sendAtDate,
    getTopStatsDate: topStatsDate.toISOString().split('.')[0],
    reportStatsDate: reportStatsDate.toISOString().split('.')[0],
    subject: `Serverless Picks of the Week #${dataTemplate.metadata.number} - ${dataTemplate.metadata.title}`
  };
};

const processSection = (section, sponsor) => {
  const newlineIndex = section.indexOf('\n');
  const header = section.substring(0, newlineIndex);
  let content = section.substring(newlineIndex + 1).trim();
  content = content.replace(/\n/g, '<br>');
  let html = convertToHtml(content);
  if (html.includes('{{< sponsor >}}')) {
    html = html.replace(/\{\{< sponsor >\}\}/g, formatSponsorAd(sponsor.ad));
  }

  return {
    header,
    html: html,
    raw: content
  };
};

const processTipOfTheWeek = (section) => {
  const socials = section.raw.matchAll(/\{\{<\s*social\s+url="([^"]+)"(?:\s+[^>]*)?>\}\}/g);

  for (const social of socials) {
    let text = section.raw.replace(social[0], '').trim();
    text = convertToHtml(text, true);

    const socialUrl = social[1];
    return { text, url: socialUrl };
  }
};

const getSponsorDetails = async (sponsorName, description) => {
  if (!sponsorName) return null;

  const sponsor = await getSponsor(sponsorName);
  if (sponsor) {
    let sponsorAd = description ?? sponsor.description;

    return {
      name: sponsor.name,
      url: sponsor.homepage,
      logo_url: sponsor.logo_url,
      shortDescription: convertToHtml(sponsor.short_description, true),
      ad: sponsorAd,
      displayName: sponsor.displayName ?? true
    };
  }
};

const convertToHtml = (data, removeOuterParagraph = false) => {
  let html = converter.makeHtml(data).replace('</p>\n<p>', '</p><br><p>').replace('</p>\n<p>', '</p><br><p>');
  if (removeOuterParagraph) {
    html = html.replace('<p>', '').replace('</p>', '');
  }

  return html;
};

const formatSponsorAd = (ad) => {
  const formattedAd = convertToHtml(ad, true);
  return `<div style="border-style:solid;border-width:1px;border-color:lightgray;border-radius:15px;padding:.7em;margin-bottom:1em;">
  <p>
      ${formattedAd}
  <i>Sponsored</i>
  </p>
</div>`;
};

const updateSourceWithRedirects = async (fileName, content, data) => {
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

const getAuthor = async (metadataAuthor) => {
  if (!metadataAuthor) return null;

  const data = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: metadataAuthor,
      sk: 'author'
    })
  }));

  if (data?.Item) {
    const author = unmarshall(data.Item);
    return {
      name: author.name,
      twitter: author.twitter
    };
  }

  return null;
};

const getSponsor = async (sponsorName) => {

  let data = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: sponsorName,
      sk: 'sponsor'
    })
  }));

  if (data?.Item) {
    data = unmarshall(data.Item);
    const { pk, sk, GSI1PK, GSI1SK, ...sponsor } = data;
    return sponsor;
  }

  return null;
};
