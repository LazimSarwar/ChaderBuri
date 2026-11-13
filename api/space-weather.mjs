import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);

// server/space-weather.ts
var KINDS = ["FLR", "CME", "SEP", "notifications"];
var TTL = 10 * 6e4;
var RETRY = 6e4;
var MAX_STALE = 24 * 60 * 6e4;
var SOURCE = "https://ccmc.gsfc.nasa.gov/tools/DONKI/";
var FeedError = class extends Error {
};
var object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
var utc = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const time = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : value + "Z");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
var id = (value, fallback) => typeof value === "string" && /^[A-Za-z0-9_.:\-]{1,120}$/.test(value) ? value : fallback;
function sourceURL(value) {
  if (typeof value !== "string" || value.length > 1200) return SOURCE;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "nasa.gov" || url.hostname.endsWith(".nasa.gov"))) return SOURCE;
    if ([...url.searchParams.keys()].some((key) => /key|token|secret/i.test(key))) return SOURCE;
    if (url.hostname === "kauai.ccmc.gsfc.nasa.gov" && url.pathname.startsWith("/DONKI/")) url.hostname = "ccmc.gsfc.nasa.gov";
    return url.href;
  } catch {
    return SOURCE;
  }
}
function normalizeWeather(kind, raw, startMs, endMs) {
  if (!Array.isArray(raw) || raw.length > 5e3) throw new Error("Invalid NASA report");
  const events = [], seen = /* @__PURE__ */ new Set();
  let count = 0, skipped = 0;
  for (const value of raw) {
    const row = object(value);
    if (!row) {
      skipped++;
      continue;
    }
    const timeUTC = utc(kind === "CME" ? row.startTime : kind === "notifications" ? row.messageIssueTime : kind === "SEP" ? row.eventTime : row.beginTime);
    if (!timeUTC) {
      skipped++;
      continue;
    }
    const time = Date.parse(timeUTC);
    if (time < startMs || time > endMs) continue;
    const eventId = id(row.flrID ?? row.activityID ?? row.sepID ?? row.messageID, kind + ":" + timeUTC);
    if (seen.has(eventId)) continue;
    seen.add(eventId);
    const event = { id: eventId, kind, timeUTC, title: "", sourceURL: sourceURL(row.link ?? row.messageURL) };
    if (kind === "FLR") {
      const flareClass = typeof row.classType === "string" && /^[ABCMX]\d{1,3}(?:\.\d{1,2})?$/.test(row.classType) ? row.classType : null;
      if (flareClass) event.classType = flareClass;
      event.title = flareClass ? "Solar flare \xB7 " + flareClass : "Solar flare \xB7 class not supplied";
    } else if (kind === "CME") {
      event.title = "Solar eruption reported";
      const analysis = Array.isArray(row.cmeAnalyses) ? row.cmeAnalyses.map(object).find((a) => a?.isMostAccurate === true) : null;
      if (analysis && typeof analysis.speed === "number" && Number.isFinite(analysis.speed) && analysis.speed > 0 && analysis.speed <= 1e4) event.speedKms = analysis.speed;
    } else if (kind === "SEP") {
      event.title = "Energetic particles detected";
      const locations = Array.isArray(row.instruments) ? row.instruments.map(object).flatMap((i) => typeof i?.displayName === "string" && /^[A-Za-z0-9 :/_().+\-]{1,100}$/.test(i.displayName) ? [i.displayName] : []).slice(0, 3) : [];
      if (locations.length) event.observingLocation = locations.join(", ");
    } else {
      const type = typeof row.messageType === "string" && /^(?:FLR|CME|SEP|IPS|MPC|GST|RBE|HSS|Report|report)$/.test(row.messageType) ? row.messageType : null;
      event.title = type ? "NASA " + type.toUpperCase() + " notice" : "NASA space-weather notice";
    }
    events.push(event);
    count++;
  }
  events.sort((a, b) => Date.parse(b.timeUTC) - Date.parse(a.timeUTC));
  return { events: events.slice(0, 10), count, skipped };
}
function createSpaceWeatherService(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const feeds = /* @__PURE__ */ new Map();
  let cached = null, validUntil = 0, pending = null;
  const get = async (config) => {
    const checkedMs = now(), checkedUTC = new Date(checkedMs).toISOString(), endDate = checkedUTC.slice(0, 10);
    const startMs = Date.parse(endDate + "T00:00:00Z") - 6 * 864e5, rangeStartUTC = new Date(startMs).toISOString();
    const base = { checkedUTC, rangeStartUTC, rangeEndUTC: checkedUTC };
    if (!config.apiKey?.trim() || /^your[-_]/i.test(config.apiKey.trim())) return { ...base, configured: false, status: "unconfigured", sources: [], events: [], message: "NASA space-weather reports are not connected on this server yet.", refreshAfterUTC: new Date(checkedMs + RETRY).toISOString() };
    if (cached && validUntil > checkedMs) return cached;
    if (pending) return pending;
    const key = config.apiKey.trim();
    pending = (async () => {
      const sources = [], events = [];
      await Promise.all(KINDS.map(async (kind) => {
        try {
          const url = new URL("https://api.nasa.gov/DONKI/" + kind);
          url.searchParams.set("startDate", rangeStartUTC.slice(0, 10));
          url.searchParams.set("endDate", endDate);
          url.searchParams.set("api_key", key);
          if (kind === "notifications") url.searchParams.set("type", "all");
          const requestOptions = { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8e3), redirect: "error" };
          let response = await fetchImpl(url, requestOptions);
          if (response.status === 404 || response.status === 410 || response.status >= 500 && response.status <= 599) {
            await response.body?.cancel().catch(() => {
            });
            const fallback = new URL("https://ccmc.gsfc.nasa.gov/DONKI-API/get/" + kind);
            fallback.searchParams.set("startDate", rangeStartUTC.slice(0, 10));
            fallback.searchParams.set("endDate", endDate);
            if (kind === "notifications") fallback.searchParams.set("type", "all");
            response = await fetchImpl(fallback, requestOptions);
          }
          if (!response.ok) throw new FeedError(response.status === 429 ? "NASA\u2019s request limit was reached. Try again later." : response.status === 401 || response.status === 403 ? "NASA could not authorise this server\u2019s connection. The site owner needs to check it." : "This NASA feed is temporarily unavailable.");
          const length = Number(response.headers.get("content-length"));
          if (Number.isFinite(length) && length > 15e5) throw new Error("size");
          const reader = response.body?.getReader();
          if (!reader) throw new Error("empty");
          const chunks = [];
          let size = 0;
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 15e5) {
              await reader.cancel();
              throw new Error("size");
            }
            chunks.push(chunk.value);
          }
          const text = Buffer.concat(chunks).toString("utf8");
          const normalized = normalizeWeather(kind, JSON.parse(text), startMs, checkedMs);
          const feed = { ...normalized, fetchedUTC: new Date(now()).toISOString() };
          feeds.set(kind, feed);
          events.push(...feed.events);
          sources.push({ kind, status: feed.skipped ? "partial" : "ok", count: feed.count, fetchedUTC: feed.fetchedUTC, skipped: feed.skipped, message: feed.skipped ? "Some entries could not be read." : "" });
        } catch (error) {
          const problem = error instanceof FeedError ? error.message : "This NASA feed could not be reached or read.";
          const prior = feeds.get(kind);
          if (prior && checkedMs - Date.parse(prior.fetchedUTC) < MAX_STALE) {
            const inRange = prior.events.filter((e) => Date.parse(e.timeUTC) >= startMs && Date.parse(e.timeUTC) <= checkedMs);
            events.push(...inRange);
            sources.push({ kind, status: "stale", count: null, fetchedUTC: prior.fetchedUTC, skipped: 0, message: problem + " These entries are from an earlier check." });
          } else sources.push({ kind, status: "unavailable", count: null, fetchedUTC: null, skipped: 0, message: problem });
        }
      }));
      sources.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
      const healthy = sources.filter((s) => s.status === "ok").length, any = sources.some((s) => s.status === "ok" || s.status === "partial" || s.status === "stale");
      const status = healthy === KINDS.length ? "available" : any ? "partial" : "unavailable";
      const ttl = status === "available" ? TTL : RETRY;
      cached = { ...base, configured: true, status, sources, events: events.sort((a, b) => Date.parse(b.timeUTC) - Date.parse(a.timeUTC)), message: status === "available" ? "Recent NASA reports, checked on request." : status === "partial" ? "Some NASA feeds are delayed or unavailable. Read each feed\u2019s status." : "NASA reports are temporarily unavailable. No current activity assessment is shown.", refreshAfterUTC: new Date(now() + ttl).toISOString() };
      validUntil = now() + ttl;
      return cached;
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
  return { get };
}
var service = createSpaceWeatherService();
async function spaceWeatherHTTP(req, res, config) {
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json", Allow: "GET", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: "Use GET for NASA space-weather reports." }));
    return;
  }
  const data = await service.get(config);
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(data));
}

// api/space-weather.ts
async function handler(req, res) {
  await spaceWeatherHTTP(req, res, { apiKey: process.env.NASA_API_KEY });
}
export {
  handler as default
};
