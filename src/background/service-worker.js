const YOUTUBE_URL = /^(https:\/\/)?(www\.)?youtube\.com\/watch|^https:\/\/music\.youtube\.com\/watch/;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || !YOUTUBE_URL.test(tab.url)) return;

  await chrome.sidePanel.setOptions({
    tabId,
    path: "src/sidepanel/sidepanel.html",
    enabled: true
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "OPEN_LYRICS_SEARCH") return;

  const query = [message.artist, message.track, "lyrics"].filter(Boolean).join(" ");
  chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
  sendResponse({ ok: true });
});
