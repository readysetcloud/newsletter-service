# Newsletter Content Curator (Chrome extension)

Save links from LinkedIn posts into your newsletter service while you scroll.
Saved links are vetted by AI against your newsletter's focus and served back as
an RSS feed for your Friday writing session. Backend details:
[`docs/content-curation.md`](../docs/content-curation.md).

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension/` directory.

## Configure

1. Mint a tenant API key from the newsletter dashboard (API Keys page).
2. Click the extension icon and enter:
   - **API base URL** — your public API base, e.g.
     `https://<api-id>.execute-api.<region>.amazonaws.com/public`
     (or your custom domain).
   - **API key** — the `ak_...` key you minted.
3. Click **Save settings**.

## Use

- Browse LinkedIn. Posts containing external links get a
  **📰 Save for newsletter** button next to the like/comment bar.
- Click it to submit the post's links with context (author, post text,
  permalink). The button turns green when saved; duplicates are fine —
  the backend dedupes.
- The popup shows your recently saved links.

## Friday feed

From the popup:

- **Open RSS feed** — vetted, recommended links from the past 7 days.
- **Open JSON view** — everything, including pending and skipped items.
- **Copy RSS URL for your reader** — paste into any RSS reader. The URL
  embeds your API key, so treat it like a password.

## Notes

- LinkedIn changes its DOM frequently. The content script uses several
  fallback selectors, but if buttons stop appearing, update the selector
  lists at the top of `content.js`.
- `lnkd.in` short links are submitted as-is; the backend unwraps them
  during vetting.
