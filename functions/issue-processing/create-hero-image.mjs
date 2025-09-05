import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import crypto from "crypto";

const s3 = new S3Client();

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 48;
const DEFAULT_PRIMARY = "#0b1223";
const DEFAULT_SECONDARY = "#1f2a44";
const DEFAULT_TITLE_COLOR = "#ffffff";
const DEFAULT_META_COLOR = "#e6e8ef";
const DEFAULT_TITLE_FONT_FAMILY = "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
const DEFAULT_TEXT_FONT_FAMILY = "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";

const TEMPLATES = [
  {
    name: "logoTopLeft_titleCenter_issueTopRight",
    logo: { x: PADDING, y: PADDING, maxW: 280, maxH: 120 },
    issue: { x: WIDTH - PADDING - 260, y: PADDING + 8, align: "right", width: 260 },
    title: { x: PADDING, y: HEIGHT * 0.36, width: WIDTH - PADDING * 2, align: "center", maxLines: 3 },
    tagline: { x: PADDING, y: HEIGHT * 0.36 + 220, width: WIDTH - PADDING * 2, align: "center", maxLines: 2 }
  },
  {
    name: "logoBottomLeft_titleLeft_issueTopLeft",
    logo: { x: PADDING, y: HEIGHT - 140, maxW: 300, maxH: 120 },
    issue: { x: PADDING, y: PADDING + 8, align: "left", width: 260 },
    title: { x: PADDING, y: HEIGHT * 0.28, width: WIDTH * 0.62, align: "left", maxLines: 3 },
    tagline: { x: PADDING, y: HEIGHT * 0.28 + 200, width: WIDTH * 0.62, align: "left", maxLines: 2 }
  },
  {
    name: "logoTopCenter_titleBottomRight_issueBottomLeft",
    logo: { x: WIDTH / 2 - 160, y: PADDING, maxW: 320, maxH: 120 },
    issue: { x: PADDING, y: HEIGHT - 80, align: "left", width: 320 },
    title: { x: WIDTH * 0.38, y: HEIGHT * 0.52, width: WIDTH * 0.54 - PADDING, align: "right", maxLines: 3 },
    tagline: { x: WIDTH * 0.38, y: HEIGHT * 0.52 + 200, width: WIDTH * 0.54 - PADDING, align: "right", maxLines: 2 }
  },
  {
    name: "logoTopRight_titleLeft_issueTopRight",
    logo: { x: WIDTH - PADDING - 260, y: PADDING, maxW: 260, maxH: 110 },
    issue: { x: WIDTH - PADDING - 260, y: PADDING + 120, align: "right", width: 260 },
    title: { x: PADDING, y: HEIGHT * 0.34, width: WIDTH * 0.64, align: "left", maxLines: 3 },
    tagline: { x: PADDING, y: HEIGHT * 0.34 + 200, width: WIDTH * 0.64, align: "left", maxLines: 2 }
  }
];


const bufFromStream = async (stream) =>
  new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => res(Buffer.concat(chunks)));
    stream.on("error", rej);
  });

const seeded = (seed) => {
  // Deterministic PRNG in [0,1)
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  let x = h.readUInt32BE(0) / 0xffffffff;
  return () => {
    // xorshift-ish
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    // ensure number space
    x = (x >>> 0) / 0xffffffff;
    return x;
  };
};

const pickTemplate = (tenantId, issueNumber) => {
  const hash = crypto.createHash("sha256").update(`${tenantId}:${issueNumber}`).digest();
  const n = hash[0] % TEMPLATES.length;
  return TEMPLATES[n];
};

// Slight jitter (±12px) to avoid looking static while staying clean
const jitterRect = (rect, rng) => {
  const j = 12;
  return {
    ...rect,
    x: Math.round(rect.x + (rng() * 2 - 1) * j),
    y: Math.round(rect.y + (rng() * 2 - 1) * j),
  };
};

const gradientSvg = ({ c1, c2, width, height }) => `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>
`;

const textBlockSvg = ({
  x, y, width, color, fontFamily, fontWeight = 700, fontSize = 64, lineHeight = 1.2,
  text, align = "left", maxLines = 3
}) => {
  const safe = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // CSS clamps lines to avoid overflow
  return `
<svg width="${width}" height="${Math.ceil(fontSize * lineHeight * maxLines) + 8}" xmlns="http://www.w3.org/2000/svg">
  <foreignObject x="0" y="0" width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml"
         style="
           color:${color};
           font-family:${fontFamily};
           font-weight:${fontWeight};
           font-size:${fontSize}px;
           line-height:${lineHeight};
           display:-webkit-box;
           -webkit-line-clamp:${maxLines};
           -webkit-box-orient:vertical;
           overflow:hidden;
           text-align:${align};
           letter-spacing:0.2px;
           ">
      ${safe(text)}
    </div>
  </foreignObject>
</svg>
`;
};

const metaTextSvg = ({
  width, text, color, fontFamily, align = "left", fontSize = 28, weight = 600, maxLines = 2
}) => textBlockSvg({
  x: 0, y: 0, width, color, fontFamily, fontWeight: weight, fontSize, lineHeight: 1.25, text, align, maxLines
});

// Get dominant color from the logo for auto-branding if no color provided
const dominantFromLogo = async (logoBuf) => {
  try {
    const stats = await sharp(logoBuf).stats();
    const { r, g, b } = stats.dominant;
    // Build a calm gradient from dominant to a darker sibling
    const base = `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    const darker = `#${[r, g, b].map(v => Math.max(0, Math.round(v * 0.6)).toString(16).padStart(2, "0")).join("")}`;
    return { c1: darker, c2: base };
  } catch {
    return { c1: DEFAULT_PRIMARY, c2: DEFAULT_SECONDARY };
  }
};

// Optionally embed custom fonts in SVG via @font-face (pass data: URLs)
const fontFaceCss = (titleFontDataUrl, textFontDataUrl) => `
  ${titleFontDataUrl ? `
  @font-face { font-family: 'TenantTitle'; src: url(${titleFontDataUrl}) format('woff2'); font-weight: 400 800; font-style: normal; font-display: swap; }` : ``}
  ${textFontDataUrl ? `
  @font-face { font-family: 'TenantText'; src: url(${textFontDataUrl}) format('woff2'); font-weight: 400 700; font-style: normal; font-display: swap; }` : ``}
`;

const dataUrl = (buf, mime = "font/woff2") => `data:${mime};base64,${buf.toString("base64")}`;

/**
 * Event shape (example):
 * {
 *   tenantId: "acme",
 *   issueNumber: 42,
 *   title: "How We Shipped Zero-Downtime",
 *   tagline: "Practical patterns for resilient systems",
 *   logoBucket: "brand-assets",
 *   logoKey: "acme/logo.png",
 *   // optional tenant branding:
 *   primaryColor: "#123456",
 *   secondaryColor: "#0e2433",
 *   titleFont: { bucket: "brand-assets", key: "acme/fonts/Title.woff2", mime: "font/woff2" },
 *   textFont: { bucket: "brand-assets", key: "acme/fonts/Text.woff2", mime: "font/woff2" },
 *   // output:
 *   outBucket: "newsletter-images",
 *   outKey: "acme/issues/42/hero.png"
 * }
 */
export const handler = async (event) => {
  try {
    const {
      tenantId,
      issueNumber,
      title,
      tagline,
      logoBucket,
      logoKey,
      primaryColor,
      secondaryColor,
      titleFont,
      textFont,
      outBucket,
      outKey
    } = event;

    if (!tenantId || issueNumber == null || !logoBucket || !logoKey || !outBucket || !outKey) {
      return { ok: false, error: "Missing required fields: tenantId, issueNumber, logoBucket, logoKey, outBucket, outKey" };
    }

    const logoObj = await s3.send(new GetObjectCommand({ Bucket: logoBucket, Key: logoKey }));
    const logoBuf = await bufFromStream(logoObj.Body);

    let titleFontUrl = null, textFontUrl = null;
    if (titleFont?.bucket && titleFont?.key) {
      const f = await s3.send(new GetObjectCommand({ Bucket: titleFont.bucket, Key: titleFont.key }));
      const fBuf = await bufFromStream(f.Body);
      titleFontUrl = dataUrl(fBuf, titleFont.mime || "font/woff2");
    }
    if (textFont?.bucket && textFont?.key) {
      const f = await s3.send(new GetObjectCommand({ Bucket: textFont.bucket, Key: textFont.key }));
      const fBuf = await bufFromStream(f.Body);
      textFontUrl = dataUrl(fBuf, textFont.mime || "font/woff2");
    }

    const rng = seeded(`${tenantId}:${issueNumber}`);
    const template = pickTemplate(tenantId, issueNumber);

    const grad = (primaryColor && secondaryColor)
      ? { c1: primaryColor, c2: secondaryColor }
      : await dominantFromLogo(logoBuf);

    const bg = Buffer.from(gradientSvg({ c1: grad.c1 || DEFAULT_PRIMARY, c2: grad.c2 || DEFAULT_SECONDARY, width: WIDTH, height: HEIGHT }));

    let img = await sharp(bg).png().resize(WIDTH, HEIGHT, { fit: "cover" }).toBuffer();

    const logoMeta = await sharp(logoBuf).metadata();
    const scale = Math.min(
      (template.logo.maxW || 300) / (logoMeta.width || 1),
      (template.logo.maxH || 120) / (logoMeta.height || 1),
      1
    );
    const logoResized = await sharp(logoBuf)
      .resize({
        width: Math.round((logoMeta.width || 1) * scale),
        height: Math.round((logoMeta.height || 1) * scale),
        fit: "inside",
        withoutEnlargement: true
      })
      .png()
      .toBuffer();

    const titleFontFamily = titleFontUrl ? "'TenantTitle', " + DEFAULT_TITLE_FONT_FAMILY : DEFAULT_TITLE_FONT_FAMILY;
    const textFontFamily = textFontUrl ? "'TenantText', " + DEFAULT_TEXT_FONT_FAMILY : DEFAULT_TEXT_FONT_FAMILY;

    const cssEmbedSvg = `
<svg width="1" height="1" xmlns="http://www.w3.org/2000/svg">
  <style>
    ${fontFaceCss(titleFontUrl, textFontUrl)}
  </style>
</svg>`.trim();

    const titleBlock = (title && title.trim().length > 0) ? Buffer.from(
      textBlockSvg({
        x: 0,
        y: 0,
        width: Math.floor(template.title.width),
        color: DEFAULT_TITLE_COLOR,
        fontFamily: titleFontFamily,
        fontWeight: 800,
        fontSize: 72,
        lineHeight: 1.1,
        text: title,
        align: template.title.align,
        maxLines: template.title.maxLines
      })
    ) : null;

    const taglineBlock = (tagline && tagline.trim().length > 0) ? Buffer.from(
      metaTextSvg({
        width: Math.floor(template.tagline.width),
        text: tagline,
        color: DEFAULT_META_COLOR,
        fontFamily: textFontFamily,
        align: template.tagline.align,
        fontSize: 34,
        weight: 600,
        maxLines: template.tagline.maxLines
      })
    ) : null;

    const issueStr = `Issue #${issueNumber}`;
    const issueBlock = Buffer.from(
      metaTextSvg({
        width: Math.floor(template.issue.width),
        text: issueStr,
        color: DEFAULT_META_COLOR,
        fontFamily: textFontFamily,
        align: template.issue.align,
        fontSize: 30,
        weight: 700,
        maxLines: 1
      })
    );

    const logoPos = jitterRect(template.logo, rng);
    const titlePos = titleBlock ? jitterRect(template.title, rng) : null;
    const taglinePos = taglineBlock ? jitterRect(template.tagline, rng) : null;
    const issuePos = jitterRect(template.issue, rng);

    const composites = [
      { input: Buffer.from(cssEmbedSvg), left: 0, top: 0 },
      { input: logoResized, left: Math.max(0, Math.min(WIDTH - 1, logoPos.x)), top: Math.max(0, Math.min(HEIGHT - 1, logoPos.y)) },
      { input: issueBlock, left: Math.max(0, Math.min(WIDTH - Math.floor(template.issue.width), issuePos.x)), top: Math.max(0, Math.min(HEIGHT - 40, issuePos.y)) },
    ];
    if (titleBlock) {
      composites.push({ input: titleBlock, left: Math.max(0, Math.min(WIDTH - Math.floor(template.title.width), titlePos.x)), top: Math.max(0, Math.min(HEIGHT - 240, titlePos.y)) });
    }
    if (taglineBlock) {
      composites.push({ input: taglineBlock, left: Math.max(0, Math.min(WIDTH - Math.floor(template.tagline.width), taglinePos.x)), top: Math.max(0, Math.min(HEIGHT - 120, taglinePos.y)) });
    }

    const finalBuf = await sharp(img).composite(composites).png().toBuffer();

    await s3.send(new PutObjectCommand({
      Bucket: outBucket,
      Key: outKey,
      Body: finalBuf,
      ContentType: "image/png",
      ACL: "public-read"
    }));

    return {
      success: true,
      url: `https://${outBucket}.s3.amazonaws.com/${encodeURIComponent(outKey)}`
    };
  } catch (err) {
    console.error(err);
    return { success: false };
  }
};
