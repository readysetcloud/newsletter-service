const apiBaseUrlInput = document.getElementById('apiBaseUrl');
const apiKeyInput = document.getElementById('apiKey');
const settingsStatus = document.getElementById('settingsStatus');
const feedStatus = document.getElementById('feedStatus');

function feedUrl(baseUrl, apiKey, format) {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/content-candidates/feed`);
  url.searchParams.set('key', apiKey);
  if (format) url.searchParams.set('format', format);
  return url.toString();
}

function showStatus(element, message, ok) {
  element.textContent = message;
  element.className = `status ${ok ? 'ok' : 'error'}`;
  element.hidden = false;
  setTimeout(() => { element.hidden = true; }, 3000);
}

function refreshFeedLinks(config) {
  const configured = Boolean(config.apiBaseUrl && config.apiKey);
  const rssLink = document.getElementById('rssLink');
  const jsonLink = document.getElementById('jsonLink');

  if (configured) {
    rssLink.href = feedUrl(config.apiBaseUrl, config.apiKey);
    jsonLink.href = feedUrl(config.apiBaseUrl, config.apiKey, 'json');
  } else {
    rssLink.removeAttribute('href');
    jsonLink.removeAttribute('href');
  }
}

async function loadRecentSaves() {
  const { recentSaves = [] } = await chrome.storage.local.get('recentSaves');
  const list = document.getElementById('recentList');
  const empty = document.getElementById('recentEmpty');

  list.replaceChildren();
  empty.hidden = recentSaves.length > 0;

  for (const entry of recentSaves.slice(0, 25)) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = entry.url;

    const meta = document.createElement('span');
    meta.className = 'meta';
    const savedAt = new Date(entry.savedAt).toLocaleString();
    meta.textContent = [entry.author, savedAt, entry.status === 'duplicate' ? 'already saved' : null]
      .filter(Boolean)
      .join(' · ');

    item.append(link, meta);
    list.appendChild(item);
  }
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const apiBaseUrl = apiBaseUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!apiBaseUrl || !apiKey) {
    showStatus(settingsStatus, 'Both fields are required', false);
    return;
  }

  try {
    new URL(apiBaseUrl);
  } catch {
    showStatus(settingsStatus, 'API base URL is not a valid URL', false);
    return;
  }

  await chrome.storage.sync.set({ apiBaseUrl, apiKey });
  refreshFeedLinks({ apiBaseUrl, apiKey });
  showStatus(settingsStatus, 'Settings saved', true);
});

document.getElementById('copyRss').addEventListener('click', async () => {
  const config = await chrome.storage.sync.get(['apiBaseUrl', 'apiKey']);
  if (!config.apiBaseUrl || !config.apiKey) {
    showStatus(feedStatus, 'Save your settings first', false);
    return;
  }
  await navigator.clipboard.writeText(feedUrl(config.apiBaseUrl, config.apiKey));
  showStatus(feedStatus, 'RSS URL copied', true);
});

(async function init() {
  const config = await chrome.storage.sync.get(['apiBaseUrl', 'apiKey']);
  if (config.apiBaseUrl) apiBaseUrlInput.value = config.apiBaseUrl;
  if (config.apiKey) apiKeyInput.value = config.apiKey;
  refreshFeedLinks(config);
  await loadRecentSaves();
})();
