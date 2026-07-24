/**
 * Background service worker. Receives candidates from the content script,
 * submits them to the newsletter service, and keeps a local log of recent
 * saves for the popup.
 */

const RECENT_SAVES_LIMIT = 100;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'saveCandidate') {
    submitCandidate(message.candidate)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'Unexpected error' }));
    return true; // keep the message channel open for the async response
  }
  return false;
});

async function submitCandidate(candidate) {
  const { apiBaseUrl, apiKey } = await chrome.storage.sync.get(['apiBaseUrl', 'apiKey']);
  if (!apiBaseUrl || !apiKey) {
    return { ok: false, error: 'Set the API base URL and API key in the extension popup first.' };
  }

  let response;
  try {
    response = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}/content-candidates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey
      },
      body: JSON.stringify(candidate)
    });
  } catch (err) {
    return { ok: false, error: `Could not reach the newsletter service: ${err.message}` };
  }

  if (response.status === 403) {
    return { ok: false, error: 'The API rejected your key. Check the extension settings.' };
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // keep default message
    }
    return { ok: false, error: message };
  }

  const result = await response.json();
  await recordSaves(candidate, result);
  return { ok: true, result };
}

async function recordSaves(candidate, result) {
  const saved = [
    ...(result.accepted ?? []).map((entry) => ({ url: entry.url, status: 'accepted' })),
    ...(result.duplicates ?? []).map((url) => ({ url, status: 'duplicate' }))
  ];
  if (!saved.length) return;

  const { recentSaves = [] } = await chrome.storage.local.get('recentSaves');
  const now = new Date().toISOString();
  const entries = saved.map((entry) => ({
    ...entry,
    author: candidate.post?.author || '',
    savedAt: now
  }));

  await chrome.storage.local.set({
    recentSaves: [...entries, ...recentSaves].slice(0, RECENT_SAVES_LIMIT)
  });
}
