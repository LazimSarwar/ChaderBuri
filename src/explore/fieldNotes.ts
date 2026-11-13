// Field notes and observation markers written on the surface. Stored on this device only
// (localStorage 'chader-buri.field-notes-v1'); malformed storage never breaks the visit.
export const FIELD_NOTES_KEY = 'chader-buri.field-notes-v1'
export const MAX_FIELD_NOTES = 50
export const MAX_NOTE_CHARS = 500

export type FieldNote = {
  id: string
  /** note = written in the journal; marker = an observation marker placed on the terrain map. */
  kind: 'note' | 'marker'
  siteSlug: string
  siteName: string
  /** Visitor position: metres east/north of the landing point, and lat/lon when the scene reported it. */
  eastM: number
  northM: number
  lat: number | null
  lonEast: number | null
  sceneUTC: string
  createdUTC: string
  text: string
}

const str = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : null
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null
const iso = (v: unknown) => { const s = str(v, 40); return s && Number.isFinite(Date.parse(s)) ? s : null }

function cleanNote(raw: unknown): FieldNote | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id, 80), siteSlug = str(r.siteSlug, 80), sceneUTC = iso(r.sceneUTC), createdUTC = iso(r.createdUTC)
  const eastM = num(r.eastM), northM = num(r.northM)
  if (!id || !siteSlug || !sceneUTC || !createdUTC || eastM === null || northM === null) return null
  const kind = r.kind === 'marker' ? 'marker' : r.kind === 'note' ? 'note' : null
  if (!kind) return null
  const lat = num(r.lat), lonEast = num(r.lonEast)
  return { id, kind, siteSlug, siteName: str(r.siteName, 120) ?? siteSlug, eastM, northM,
    lat: lat !== null && Math.abs(lat) <= 90 ? lat : null, lonEast: lonEast !== null && Math.abs(lonEast) <= 360 ? lonEast : null,
    sceneUTC, createdUTC, text: str(r.text, MAX_NOTE_CHARS) ?? '' }
}

/** Robust parse of stored notes: accepts a JSON string or a parsed value; drops anything malformed. */
export function parseFieldNotes(raw: unknown): FieldNote[] {
  let value = raw
  if (typeof raw === 'string') { try { value = JSON.parse(raw) } catch { return [] } }
  if (!Array.isArray(value)) return []
  const seen = new Set<string>(), out: FieldNote[] = []
  for (const item of value) {
    const note = cleanNote(item)
    if (note && !seen.has(note.id)) { seen.add(note.id); out.push(note) }
  }
  return out.slice(-MAX_FIELD_NOTES)
}

/** Adds a note, keeping the newest `cap` (oldest dropped first). */
export function addFieldNote(list: FieldNote[], note: FieldNote, cap = MAX_FIELD_NOTES) {
  const clean = cleanNote(note)
  if (!clean) return list
  return [...list.filter(n => n.id !== clean.id), clean].slice(-Math.max(1, cap))
}
export function updateFieldNote(list: FieldNote[], id: string, text: string) {
  return list.map(n => n.id === id ? { ...n, text: text.slice(0, MAX_NOTE_CHARS) } : n)
}
export function removeFieldNote(list: FieldNote[], id: string) { return list.filter(n => n.id !== id) }

let counter = 0
export function noteId(now = Date.now()) { counter = (counter + 1) % 1000; return `fn-${now.toString(36)}-${counter}` }

/** "-84.81234°, 2.34567° E" with 5 decimals; "position unavailable" without coordinates. */
export function formatLatLon(lat: number | null | undefined, lonEast: number | null | undefined, digits = 5) {
  if (lat == null || lonEast == null || !Number.isFinite(lat) || !Number.isFinite(lonEast)) return 'position unavailable'
  return `${lat.toFixed(digits)}°, ${lonEast.toFixed(digits)}° E`
}
