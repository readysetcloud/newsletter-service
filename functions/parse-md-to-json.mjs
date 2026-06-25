
import showdown from 'showdown';
import frontmatter from '@github-docs/frontmatter';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();
const converter = new showdown.Converter();

export const handler = async (state) => {
  const newsletter = frontmatter(state.content);
  const sponsor = await getSponsorDetails(newsletter.data.sponsor, newsletter.data.sponsor_description);
  const author = await getAuthor(newsletter.data.author);
  const issueNumber = Number(state.issueId);

  if (!Number.isFinite(issueNumber) || issueNumber < 1) {
    throw new Error('Invalid or missing issueId');
  }

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
      number: issueNumber,
      title: newsletter.data.title,
      description: newsletter.data.description,
      date: formattedDate,
      url: `https://readysetcloud.io/newsletter/${issueNumber}`,
      ...(author && { author })
    },
    ...(sponsor && { sponsor }),
    content: {},
    ...state.votingOptions?.length && { votingOptions: state.votingOptions }
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

  const listCleanupDate = new Date(newsletterDate);
  listCleanupDate.setDate(listCleanupDate.getDate() + 3);

  const reportStatsDate = new Date(newsletterDate);
  reportStatsDate.setDate(reportStatsDate.getDate() + 5);

  const now = new Date();
  const sendAtDate = newsletterDate < now ? 'now' : newsletterDate.toISOString();

  return {
    data: dataTemplate,
    sendAtDate,
    listCleanupDate: listCleanupDate.toISOString().split('.')[0],
    reportStatsDate: reportStatsDate.toISOString().split('.')[0],
    subject: `${dataTemplate.metadata.title} | Ready, Set, Cloud Picks of the Week #${dataTemplate.metadata.number}`
  };
};

const processSection = (section, sponsor) => {
  const newlineIndex = section.indexOf('\n');
  const header = section.substring(0, newlineIndex);
  let content = section.substring(newlineIndex + 1).trim();

  // Pull robotVoice shortcodes out before markdown conversion so the inline
  // markdown in the `text` attribute isn't mangled. Each occurrence (0..N) is
  // swapped for an inert placeholder that survives showdown, then expanded
  // after the rest of the section has been converted to HTML.
  const robotVoices = [];
  content = content.replace(/\{\{<\s*robotVoice\s+text="([^"]+)"(?:\s+[^>]*)?>\}\}/g, (_match, text) => {
    const placeholder = `%%ROBOTVOICE${robotVoices.length}%%`;
    robotVoices.push(text);
    return placeholder;
  });

  content = content.replace(/\n/g, '<br>');
  let html = convertToHtml(content);
  if (html.includes('{{< sponsor >}}')) {
    html = html.replace(/\{\{< sponsor >\}\}/g, formatSponsorAd(sponsor.ad));
  }

  robotVoices.forEach((text, index) => {
    html = html.replace(`%%ROBOTVOICE${index}%%`, formatRobotVoice(text));
  });

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

const formatRobotVoice = (text) => {
  const formattedText = convertToHtml(text, true);
  // The labels use negative margins to sit on the card's border (the "notch").
  // Apple Mail / web clients honor this; Gmail strips the negative margins and
  // degrades cleanly to a flat label. Outlook's Word engine *does* apply them
  // and would clip the label, so it gets a flat version via an MSO conditional.
  return `<div style="margin:24px 0;border:1px solid #CFD6DC;border-radius:5px;padding:16px;background:#FFFFFF;font-family:ui-monospace,'SF Mono','Cascadia Code',Consolas,'Courier New',monospace;">
  <!--[if !mso]><!-->
  <div style="margin:-27px 0 8px 0;">
    <span style="background:#FFFFFF;padding:0 8px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8A929A;">robot voice</span>
  </div>
  <!--<![endif]-->
  <!--[if mso]>
  <div style="margin:0 0 8px 0;">
    <span style="background:#FFFFFF;padding:0 8px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8A929A;">robot voice</span>
  </div>
  <![endif]-->
  <div style="font-size:14px;line-height:1.6;color:#54606A;">
    ${formattedText}
  </div>
  <!--[if !mso]><!-->
  <div style="text-align:right;margin:8px 0 -28px 0;">
    <span style="background:#FFFFFF;padding:0 8px;font-size:11px;letter-spacing:.03em;color:#9099A1;">404 &middot; personality not found</span>
  </div>
  <!--<![endif]-->
  <!--[if mso]>
  <div style="text-align:right;margin:8px 0 0 0;">
    <span style="background:#FFFFFF;padding:0 8px;font-size:11px;letter-spacing:.03em;color:#9099A1;">404 &middot; personality not found</span>
  </div>
  <![endif]-->
</div>`;
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
