const clean = (value = "") => value.replace(/\s+/g, " ").trim();

function text(selector) {
  return clean(document.querySelector(selector)?.innerText || "");
}

function multilineText(selector) {
  return (document.querySelector(selector)?.innerText || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

function firstText(selectors) {
  for (const selector of selectors) {
    const value = text(selector);
    if (value) return value;
  }
  return "";
}

function getDescription() {
  for (const selector of ["#description-inline-expander", "#description", "ytd-watch-metadata #description"]) {
    const value = multilineText(selector);
    if (value) return value;
  }
  return "";
}

function getVisibleComments() {
  return [...document.querySelectorAll("ytd-comment-thread-renderer #content-text")]
    .map((node) => (node.innerText || "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim())
    .filter(Boolean)
    .slice(0, 40);
}

function secondsFromTimestamp(timestamp) {
  return timestamp
    .split(":")
    .reverse()
    .reduce((total, part, index) => total + Number(part) * 60 ** index, 0);
}

function titleFromLine(line) {
  return clean(line)
    // YouTube creators often write chapters as "01) 00:02:29 Song".
    .replace(/^\s*(?:\d{1,3}\s*[.)-]\s*)?(?:(?:\d{1,2}:)?\d{1,2}:\d{2})\s*/, "")
    .replace(/^[-–—|•.]\s*/, "")
    .replace(/^\d+[.)-]\s*/, "")
    .replace(/\s*[-–—|]\s*(?:live|lyrics?|letra)\b.*$/i, "")
    .trim();
}

function timestampEntries(value, source) {
  const entries = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = clean(rawLine);
    // Supports: "03:12 Song", "01:03:12 Song", and "02) 01:03:12 Song".
    const match = line.match(/^\s*(?:\d{1,3}\s*[.)-]\s*)?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s*[-–—|•.]?\s*)(.+)$/);
    if (!match) continue;

    const timestamp = match[1];
    const title = titleFromLine(line);
    if (!timestamp || title.length < 2 || title.length > 120) continue;
    entries.push({ title, timestamp, seconds: secondsFromTimestamp(timestamp), source });
  }
  return entries;
}

function numberedSetlist(value, source) {
  const lines = value.split(/\r?\n/).map(clean).filter(Boolean);
  const headingIndex = lines.findIndex((line) => /\b(set\s*list|setlist|track\s*list|canciones?)\b/i.test(line));
  if (headingIndex === -1) return [];

  return lines.slice(headingIndex + 1, headingIndex + 25)
    .filter((line) => /^\d+[.)-]\s+.{2,120}$/.test(line))
    .map((line) => ({ title: titleFromLine(line), timestamp: null, seconds: null, source }))
    .filter((entry) => entry.title.length > 1);
}

function candidatesFrom(value, source) {
  const timed = timestampEntries(value, source);
  return timed.length ? timed : numberedSetlist(value, source);
}

function dedupe(entries) {
  const seen = new Map();
  return entries.filter((entry) => {
    const key = `${entry.seconds ?? ""}:${entry.title.toLocaleLowerCase()}`;
    const previous = seen.get(key);
    if (previous) {
      previous.sources = [...new Set([...(previous.sources || [previous.source]), ...(entry.sources || [entry.source])])];
      previous.source = previous.sources.join(" + ");
      if (entry.confidence === "high") previous.confidence = "high";
      return false;
    }
    entry.sources = entry.sources || [entry.source];
    seen.set(key, entry);
    return true;
  });
}

function collectVideoData() {
  const title = firstText(["ytd-watch-metadata h1 yt-formatted-string", "h1.title", "h1"])
    || document.querySelector('meta[property="og:title"]')?.content
    || document.title.replace(/\s*-\s*YouTube$/, "");
  const channel = firstText(["ytd-video-owner-renderer #channel-name a", "#owner #channel-name a"]);
  const description = getDescription();
  const comments = getVisibleComments();

  const descriptionCandidates = candidatesFrom(description, "Descripción")
    .map((entry) => ({ ...entry, confidence: "high" }));
  const commentCandidates = comments.flatMap((comment) => {
    const likelySetlist = /\b(set\s*list|setlist|track\s*list|canciones?)\b/i.test(comment);
    const timed = timestampEntries(comment, "Comentario visible");
    const matches = timed.length >= 2 || (likelySetlist && timed.length)
      ? timed
      : likelySetlist ? numberedSetlist(comment, "Comentario visible") : [];
    return matches.map((entry) => ({ ...entry, confidence: "medium" }));
  });

  return {
    videoId: new URL(location.href).searchParams.get("v"),
    url: location.href,
    title: clean(title),
    channel,
    descriptionFound: Boolean(description),
    visibleCommentCount: comments.length,
    candidates: dedupe([...descriptionCandidates, ...commentCandidates]),
    setlistConfidence: descriptionCandidates.length ? "high" : commentCandidates.length ? "medium" : "unknown"
  };
}

function getPlaybackState() {
  const player = document.querySelector("video.html5-main-video, video");
  if (!player || !Number.isFinite(player.currentTime)) return null;

  return {
    currentTime: player.currentTime,
    duration: Number.isFinite(player.duration) ? player.duration : null,
    paused: player.paused
  };
}

function seekTo(seconds) {
  const player = document.querySelector("video.html5-main-video, video");
  if (!player || !Number.isFinite(seconds)) return { ok: false };
  const limit = Number.isFinite(player.duration) ? player.duration : seconds;
  player.currentTime = Math.min(Math.max(0, seconds), limit);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_VIDEO_METADATA") {
    sendResponse(collectVideoData());
    return;
  }

  if (message.type === "GET_PLAYBACK_STATE") {
    sendResponse(getPlaybackState());
    return;
  }

  if (message.type === "SEEK_TO") {
    sendResponse(seekTo(message.seconds));
  }
});
