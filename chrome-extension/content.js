/**
 * Content script for LinkedIn. Watches the feed for posts containing external
 * links and injects a "Save for newsletter" button on each. Clicking the button
 * extracts the links plus post context (author, text, permalink) and hands it
 * to the background service worker to submit to the newsletter service.
 *
 * LinkedIn's DOM changes frequently, so selectors are defensive: multiple
 * fallbacks per element and nothing throws if a piece of context is missing.
 */

const BUTTON_CLASS = 'nlc-save-button';
const PROCESSED_ATTR = 'data-nlc-processed';

/** Hosts that never count as shareable external content. */
const IGNORED_HOSTS = new Set([
  'www.linkedin.com',
  'linkedin.com',
  'static.licdn.com',
  'media.licdn.com'
]);

const POST_SELECTORS = [
  'div.feed-shared-update-v2',
  'div[data-urn^="urn:li:activity"]',
  'div[data-id^="urn:li:activity"]'
];

const TEXT_SELECTORS = [
  '.update-components-text',
  '.feed-shared-update-v2__description',
  '.feed-shared-inline-show-more-text'
];

const AUTHOR_SELECTORS = [
  '.update-components-actor__title span[aria-hidden="true"]',
  '.update-components-actor__title',
  '.feed-shared-actor__name'
];

/**
 * Extracts candidate external links from a post element.
 * Returns [{ url, anchorText }] deduped by URL. lnkd.in short links are kept
 * as-is; the backend unwraps them when vetting.
 */
function extractLinks(post) {
  const seen = new Set();
  const links = [];

  for (const anchor of post.querySelectorAll('a[href]')) {
    let href = anchor.getAttribute('href');
    if (!href) continue;

    let url;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      continue;
    }

    if (!/^https?:$/.test(url.protocol)) continue;

    // LinkedIn wraps some external links in a redirect endpoint
    if (url.hostname.endsWith('linkedin.com') && url.pathname.startsWith('/redir/')) {
      const target = url.searchParams.get('url');
      if (!target) continue;
      try {
        url = new URL(target);
      } catch {
        continue;
      }
    }

    if (IGNORED_HOSTS.has(url.hostname)) continue;

    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    links.push({
      url: normalized,
      anchorText: (anchor.textContent || '').trim().slice(0, 300)
    });
  }

  return links;
}

function firstMatchText(root, selectors) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

function getPostUrn(post) {
  const urn = post.getAttribute('data-urn') || post.getAttribute('data-id') || '';
  return urn.startsWith('urn:li:') ? urn : '';
}

function buildCandidate(post) {
  const links = extractLinks(post);
  if (!links.length) return null;

  const urn = getPostUrn(post);
  return {
    source: 'linkedin',
    links: links.slice(0, 10),
    post: {
      author: firstMatchText(post, AUTHOR_SELECTORS).slice(0, 200),
      text: firstMatchText(post, TEXT_SELECTORS).slice(0, 2000),
      ...(urn && { url: `https://www.linkedin.com/feed/update/${urn}/` })
    }
  };
}

function setButtonState(button, state, message) {
  button.dataset.state = state;
  button.title = message || '';
  const label = button.querySelector('.nlc-save-button__label');
  if (state === 'saving') label.textContent = 'Saving…';
  else if (state === 'saved') label.textContent = 'Saved ✓';
  else if (state === 'error') label.textContent = 'Retry save';
  else label.textContent = 'Save for newsletter';
}

async function onSaveClick(button, post) {
  if (button.dataset.state === 'saving' || button.dataset.state === 'saved') return;

  const candidate = buildCandidate(post);
  if (!candidate) {
    setButtonState(button, 'error', 'No external links found in this post anymore');
    return;
  }

  setButtonState(button, 'saving');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'saveCandidate', candidate });
    if (response?.ok) {
      setButtonState(button, 'saved');
    } else {
      setButtonState(button, 'error', response?.error || 'Failed to save. Check the extension settings.');
    }
  } catch (err) {
    setButtonState(button, 'error', err?.message || 'Failed to reach the extension background worker');
  }
}

function injectButton(post) {
  if (post.hasAttribute(PROCESSED_ATTR)) return;

  // Don't mark link-less posts as processed — LinkedIn renders post content
  // lazily, so a later mutation may reveal links worth a button.
  const links = extractLinks(post);
  if (!links.length) return;

  post.setAttribute(PROCESSED_ATTR, 'true');

  const button = document.createElement('button');
  button.className = BUTTON_CLASS;
  button.type = 'button';
  button.innerHTML = '<span class="nlc-save-button__icon">📰</span><span class="nlc-save-button__label">Save for newsletter</span>';
  button.addEventListener('click', () => onSaveClick(button, post));

  // Prefer the social action bar so the button sits with like/comment/share;
  // fall back to appending at the end of the post.
  const actionBar = post.querySelector('.feed-shared-social-action-bar')
    || post.querySelector('.social-details-social-activity');
  if (actionBar?.parentElement) {
    actionBar.parentElement.insertBefore(button, actionBar.nextSibling);
  } else {
    post.appendChild(button);
  }
}

function scan(root) {
  for (const selector of POST_SELECTORS) {
    for (const post of root.querySelectorAll(selector)) {
      injectButton(post);
    }
  }
}

function start() {
  scan(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.(POST_SELECTORS.join(','))) {
          injectButton(node);
        }
        scan(node);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
