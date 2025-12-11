import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import crypto from "crypto";
import opentype from 'opentype.js';

import InterRegularOTF from './fonts/Inter-Regular.otf';

const s3 = new S3Client();

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 48;
const DEFAULT_PRIMARY = "#0b1223";
const DEFAULT_SECONDARY = "#1f2a44";
const DEFAULT_TITLE_COLOR = "#ffffff";
const DEFAULT_META_COLOR = "#e6e8ef";

const TEMPLATES = [
  // 1) Classic Center — logo TL, headline centered, subtitle close, issue BR
  {
    name: "logoTopLeft_titleCenter_issueBottomRight",
    logo: { x: PADDING, y: PADDING, maxW: 260, maxH: 110 },
    title: { x: PADDING, y: Math.round(HEIGHT * 0.38), width: WIDTH - PADDING * 2, align: "center", maxLines: 2 },
    tagline: { x: PADDING, y: Math.round(HEIGHT * 0.38) + 88, width: WIDTH - PADDING * 2, align: "center", maxLines: 2 },
    issue: { x: WIDTH - PADDING - 260, y: HEIGHT - PADDING - 40, align: "right", width: 260 }
  },

  // 2) Editorial Left Rail — logo BL, headline left, tidy subtitle, issue TR
  {
    name: "logoBottomLeft_titleLeft_issueTopRight",
    logo: { x: PADDING, y: HEIGHT - 130, maxW: 280, maxH: 110 },
    title: { x: PADDING, y: Math.round(HEIGHT * 0.26), width: Math.round(WIDTH * 0.62), align: "left", maxLines: 3 },
    tagline: { x: PADDING, y: Math.round(HEIGHT * 0.26) + 84, width: Math.round(WIDTH * 0.62), align: "left", maxLines: 2 },
    issue: { x: WIDTH - PADDING - 240, y: PADDING + 8, align: "right", width: 240 }
  },

  // 3) Right Emphasis — logo TC, headline right, subtitle close, issue BL
  {
    name: "logoTopCenter_titleRight_issueBottomLeft",
    logo: { x: Math.round(WIDTH / 2) - 160, y: PADDING, maxW: 320, maxH: 110 },
    title: { x: Math.round(WIDTH * 0.38), y: Math.round(HEIGHT * 0.40), width: Math.round(WIDTH * 0.54) - PADDING, align: "right", maxLines: 3 },
    tagline: { x: Math.round(WIDTH * 0.38), y: Math.round(HEIGHT * 0.40) + 80, width: Math.round(WIDTH * 0.54) - PADDING, align: "right", maxLines: 2 },
    issue: { x: PADDING, y: HEIGHT - PADDING - 40, align: "left", width: 280 }
  },

  // 4) Strong Left Hero — logo TR, headline left wider, issue BR
  {
    name: "logoTopRight_titleLeft_issueBottomRight",
    logo: { x: WIDTH - PADDING - 240, y: PADDING, maxW: 240, maxH: 100 },
    title: { x: PADDING, y: Math.round(HEIGHT * 0.34), width: Math.round(WIDTH * 0.70), align: "left", maxLines: 3 },
    tagline: { x: PADDING, y: Math.round(HEIGHT * 0.34) + 84, width: Math.round(WIDTH * 0.70), align: "left", maxLines: 2 },
    issue: { x: WIDTH - PADDING - 240, y: HEIGHT - PADDING - 40, align: "right", width: 240 }
  },

  // 5) Lower Third — logo TL, headline lower third, subtitle just below, issue TR
  {
    name: "logoTopLeft_titleLowerThird_issueTopRight",
    logo: { x: PADDING, y: PADDING, maxW: 260, maxH: 110 },
    title: { x: PADDING, y: Math.round(HEIGHT * 0.54), width: WIDTH - PADDING * 2, align: "center", maxLines: 2 },
    tagline: { x: PADDING, y: Math.round(HEIGHT * 0.54) + 76, width: WIDTH - PADDING * 2, align: "center", maxLines: 2 },
    issue: { x: WIDTH - PADDING - 220, y: PADDING + 8, align: "right", width: 220 }
  },

  // 6) Diagonal Balance — issue TL, headline left mid, logo BR as counterweight
  {
    name: "issueTopLeft_titleLeft_logoBottomRight",
    issue: { x: PADDING, y: PADDING + 8, align: "left", width: 260 },
    title: { x: PADDING, y: Math.round(HEIGHT * 0.36), width: Math.round(WIDTH * 0.64), align: "left", maxLines: 3 },
    tagline: { x: PADDING, y: Math.round(HEIGHT * 0.36) + 84, width: Math.round(WIDTH * 0.64), align: "left", maxLines: 2 },
    logo: { x: WIDTH - PADDING - 280, y: HEIGHT - 140, maxW: 280, maxH: 120 }
  }
];

const toArrayBuffer = (data) => {
  if (typeof data === "string") {
    const comma = data.indexOf(",");
    const base64 = comma >= 0 ? data.slice(comma + 1) : data; // be tolerant
    const buf = Buffer.from(base64, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  if (data instanceof ArrayBuffer) return data;

  throw new Error("Unsupported font import payload. Ensure .otf=dataurl in esbuild loader.");
};

const DEFAULT_FONT = opentype.parse(toArrayBuffer(InterRegularOTF));

const bufFromStream = async (stream) =>
  new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => res(Buffer.concat(chunks)));
    stream.on("error", rej);
  });

const seeded = (seed) => {
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  let x = h.readUInt32BE(0) / 0xffffffff;
  return () => {
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    x = (x >>> 0) / 0xffffffff;
    return x;
  };
};

const pickTemplate = (tenantId, issueNumber) => {
  const hash = crypto.createHash("sha256").update(`${tenantId}:${issueNumber}`).digest();
  const n = hash[0] % TEMPLATES.length;
  return TEMPLATES[n];
};

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

function wrapByWidth(font, text, fontSize, maxWidth) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    const width = font.getAdvanceWidth(test, fontSize, { kerning: true });
    if (width <= maxWidth) line = test;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function makeTextPathsSvg({
  font = DEFAULT_FONT,
  text,
  width,
  align = "left",
  fontSize = 64,
  lineHeight = 1.2,
  color = "#fff",
  stroke = "rgba(0,0,0,0.25)",
  strokeWidth = 1.5,
  maxLines = 3
}) {
  let lines = wrapByWidth(font, text, fontSize, width);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    // add ellipsis to last line if truncated
    let last = lines[lines.length - 1];
    while (font.getAdvanceWidth(last + "…", fontSize, { kerning: true }) > width && last.length > 1) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = last + "…";
  }

  const step = Math.round(fontSize * lineHeight);
  const height = Math.ceil(lines.length * step) + 8;

  const pathEls = lines.map((ln, i) => {
    const lnWidth = font.getAdvanceWidth(ln, fontSize, { kerning: true });
    let x = 0;
    if (align === "center") x = Math.floor((width - lnWidth) / 2);
    else if (align === "right") x = Math.floor(width - lnWidth);
    const y = i * step + fontSize; // baseline
    const p = font.getPath(ln, x, y, fontSize, { kerning: true });
    return `<path d="${p.toPathData(2)}"/>`;
  }).join("\n");

  return `
<svg width="${Math.floor(width)}" height="${height}" viewBox="0 0 ${Math.floor(width)} ${height}" xmlns="http://www.w3.org/2000/svg">
  <g fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" style="paint-order: stroke fill">
    ${pathEls}
  </g>
</svg>`;
}

const dominantFromLogo = async (logoBuf) => {
  try {
    const stats = await sharp(logoBuf).stats();
    const { r, g, b } = stats.dominant;
    const base = `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    const darker = `#${[r, g, b].map(v => Math.max(0, Math.round(v * 0.6)).toString(16).padStart(2, "0")).join("")}`;
    return { c1: darker, c2: base };
  } catch {
    return { c1: DEFAULT_PRIMARY, c2: DEFAULT_SECONDARY };
  }
};

export const handler = async (event) => {
  try {
    const {
      tenantId,
      issueNumber,
      title,
      tagline,
      logoKey,
      primaryColor,
      secondaryColor,
      outKey
    } = event;

    if (!tenantId || issueNumber == null || !logoKey || !outKey) {
      return { ok: false, error: "Missing required fields: tenantId, issueNumber, logoKey, outKey" };
    }

    // --- Load logo from S3 ---
    const logoObj = await s3.send(new GetObjectCommand({ Bucket: process.env.HOSTING_BUCKET_NAME, Key: logoKey }));
    const logoBuf = await bufFromStream(logoObj.Body);

    // --- Determine layout & colors ---
    const rng = seeded(`${tenantId}:${issueNumber}`);
    const template = pickTemplate(tenantId, issueNumber);

    const grad = (primaryColor && secondaryColor)
      ? { c1: primaryColor, c2: secondaryColor }
      : await dominantFromLogo(logoBuf);

    const bg = Buffer.from(gradientSvg({ c1: grad.c1 || DEFAULT_PRIMARY, c2: grad.c2 || DEFAULT_SECONDARY, width: WIDTH, height: HEIGHT }));
    let img = await sharp(bg).png().resize(WIDTH, HEIGHT, { fit: "cover" }).toBuffer();

    // --- Resize logo ---
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


    const titleSvg = (title && title.trim())
      ? makeTextPathsSvg({
        text: title,
        width: Math.floor(template.title.width),
        align: template.title.align,
        fontSize: 72,
        lineHeight: 1.1,
        maxLines: template.title.maxLines,
        color: DEFAULT_TITLE_COLOR,
        strokeWidth: 1.5
      }) : null;

    const taglineSvg = (tagline && tagline.trim())
      ? makeTextPathsSvg({
        text: tagline,
        width: Math.floor(template.tagline.width),
        align: template.tagline.align,
        fontSize: 34,
        lineHeight: 1.25,
        maxLines: template.tagline.maxLines,
        color: DEFAULT_META_COLOR,
        strokeWidth: 1
      }) : null;

    const issueSvg = makeTextPathsSvg({
      text: `Issue #${issueNumber}`,
      width: Math.floor(template.issue.width),
      align: template.issue.align,
      fontSize: 30,
      lineHeight: 1.25,
      maxLines: 1,
      color: DEFAULT_META_COLOR,
      strokeWidth: 1
    });

    const titlePng = titleSvg ? await sharp(Buffer.from(titleSvg)).png().toBuffer() : null;
    const taglinePng = taglineSvg ? await sharp(Buffer.from(taglineSvg)).png().toBuffer() : null;
    const issuePng = await sharp(Buffer.from(issueSvg)).png().toBuffer();

    // --- Positions (with jitter) ---
    const logoPos = jitterRect(template.logo, rng);
    const titlePos = titlePng ? jitterRect(template.title, rng) : null;
    const taglinePos = taglinePng ? jitterRect(template.tagline, rng) : null;
    const issuePos = jitterRect(template.issue, rng);

    // --- Composite ---
    const composites = [
      { input: logoResized, left: Math.max(0, Math.min(WIDTH - 1, logoPos.x)), top: Math.max(0, Math.min(HEIGHT - 1, logoPos.y)) },
      { input: issuePng, left: Math.max(0, Math.min(WIDTH - Math.floor(template.issue.width), issuePos.x)), top: Math.max(0, Math.min(HEIGHT - 40, issuePos.y)) },
    ];
    if (titlePng) {
      composites.push({ input: titlePng, left: Math.max(0, Math.min(WIDTH - Math.floor(template.title.width), titlePos.x)), top: Math.max(0, Math.min(HEIGHT - 240, titlePos.y)) });
    }
    if (taglinePng) {
      composites.push({ input: taglinePng, left: Math.max(0, Math.min(WIDTH - Math.floor(template.tagline.width), taglinePos.x)), top: Math.max(0, Math.min(HEIGHT - 120, taglinePos.y)) });
    }

    const finalBuf = await sharp(img).composite(composites).png().toBuffer();

    await s3.send(new PutObjectCommand({
      Bucket: process.env.HOSTING_BUCKET_NAME,
      Key: outKey,
      Body: finalBuf,
      ContentType: "image/png",
      ACL: "public-read"
    }));

    return {
      success: true,
      url: `https://${process.env.HOSTING_BUCKET_NAME}.s3.amazonaws.com/${encodeURIComponent(outKey)}`
    };
  } catch (err) {
    console.error(err);
    return { success: false, error: String(err?.message || err) };
  }
};
