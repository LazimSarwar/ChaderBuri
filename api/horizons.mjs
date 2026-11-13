import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);

// server/horizons-policy.ts
function validatedHorizonsURL(input) {
  const p = new URL(input, "http://localhost").searchParams;
  const allowed = /* @__PURE__ */ new Set(["format", "COMMAND", "EPHEM_TYPE", "CENTER", "COORD_TYPE", "SITE_COORD", "START_TIME", "STOP_TIME", "STEP_SIZE", "QUANTITIES", "EXTRA_PREC"]);
  for (const key of p.keys()) if (!allowed.has(key) || p.getAll(key).length !== 1) throw new Error("Unsupported or duplicate parameter");
  const get = (key) => (p.get(key) ?? "").replace(/^'|'$/g, "");
  if (!["10", "399"].includes(get("COMMAND")) || get("CENTER") !== "coord@301" || get("EPHEM_TYPE") !== "OBSERVER" || get("COORD_TYPE") !== "GEODETIC") throw new Error("Only lunar Sun and Earth observer queries are supported");
  const coords = get("SITE_COORD").split(",").map(Number);
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(get("SITE_COORD")) || coords.length !== 3 || coords.some((n) => !Number.isFinite(n)) || coords[0] < 0 || coords[0] >= 360 || Math.abs(coords[1]) > 90 || coords[2] < -10 || coords[2] > 20) throw new Error("Invalid observer coordinates");
  const time = (key) => {
    const s = get(key);
    if (!/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) throw new Error("Use a UTC date and time");
    const d = /* @__PURE__ */ new Date(s.replace(" ", "T") + ":00Z");
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 16).replace("T", " ") !== s || d.getUTCFullYear() > 2049) throw new Error("Invalid UTC epoch");
    return d.getTime();
  };
  const span = time("STOP_TIME") - time("START_TIME");
  if (span <= 0 || span > 31 * 864e5 || !["1h", "6h", "1d"].includes(get("STEP_SIZE")) || !["4", "4,13,20"].includes(get("QUANTITIES")) || get("format") !== "json") throw new Error("Query must span at most 31 days with a supported step and quantity");
  p.set("EXTRA_PREC", "YES");
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${p.toString()}`;
}
async function horizonsResponse(input, method = "GET") {
  const headers = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const result = (status, body) => ({ status, headers, body: JSON.stringify(body) });
  if (method !== "GET") return result(405, { error: "Use GET" });
  let url;
  try {
    url = validatedHorizonsURL(input);
  } catch (e) {
    return result(400, { error: e.message });
  }
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15e3), headers: { "user-agent": "ChaderBuri/1.0" } });
    if (!upstream.ok) return result(upstream.status === 429 ? 429 : 502, { error: "Horizons is temporarily unavailable" });
    const body = await upstream.text();
    if (body.length > 2e6) return result(502, { error: "Unexpected Horizons response size" });
    const doc = JSON.parse(body);
    if (typeof doc.result !== "string" || (!doc.result.includes("$$SOE") || !doc.result.includes("$$EOE"))) return result(502, { error: "Horizons returned no observer table" });
    return result(200, { ...doc, retrievedUTC: (/* @__PURE__ */ new Date()).toISOString() });
  } catch {
    return result(502, { error: "Horizons request failed or timed out" });
  }
}

// api/horizons.ts
async function handler(req, res) {
  const response = await horizonsResponse(req.url ?? "", req.method);
  for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value);
  res.status(response.status).end(response.body);
}
export {
  handler as default
};
