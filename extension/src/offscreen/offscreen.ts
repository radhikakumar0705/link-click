/**
 * Offscreen document used only to write to the clipboard.
 *
 * MV3 service workers have no DOM and no clipboard access. Rather than inject a
 * content script into every page (which needs <all_urls> and fails on chrome://
 * pages), the service worker opens this hidden document on demand. Offscreen
 * documents never have focus, so navigator.clipboard is unavailable; the
 * textarea + execCommand('copy') path works with the clipboardWrite permission.
 */
chrome.runtime.onMessage.addListener((msg: { target?: string; type?: string; text?: string }, _sender, sendResponse) => {
  if (msg.target !== 'offscreen' || msg.type !== 'copy') return;
  const el = document.getElementById('clip') as HTMLTextAreaElement;
  el.value = msg.text ?? '';
  el.select();
  const ok = document.execCommand('copy');
  el.value = '';
  sendResponse({ ok });
});
