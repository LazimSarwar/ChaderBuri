/** A browser-only text transcript. Commands, offers, evidence and credentials are never saved. */
export const COMPANION_HISTORY_KEY = 'chader-buri.conversation-v1'
export const MAX_COMPANION_HISTORY = 24
const MAX_DOCUMENT_LENGTH = 160_000
export type ConversationEntry = {
  id: string; at: number; question: string; answer: string; source: 'ai' | 'calculated'
  contextStamp: string; siteName: string; sceneUTC: string | null
  /** A restored entry is a record, even when the current scene happens to have the same date. */
  restored?: boolean
}
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const browserStorage = (): BrowserStorage | null => { try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null } }
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null

export function parseCompanionHistory(raw: string | null): ConversationEntry[] {
  if (!raw || raw.length > MAX_DOCUMENT_LENGTH) return []
  try {
    const data = JSON.parse(raw)
    if (data?.v !== 1 || !Array.isArray(data.entries)) return []
    const seen = new Set<string>()
    return data.entries.slice(-MAX_COMPANION_HISTORY).flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return []
      const e = entry as Record<string, unknown>, id = text(e.id, 120), question = text(e.question, 1000), answer = text(e.answer, 4000)
      const contextStamp = text(e.contextStamp, 6000), siteName = text(e.siteName, 120)
      if (!id || !question || !answer || !contextStamp || !siteName || !Number.isFinite(e.at) || Number(e.at) < 0 || !['ai', 'calculated'].includes(String(e.source)) || seen.has(id)) return []
      const sceneUTC = typeof e.sceneUTC === 'string' && e.sceneUTC.length <= 40 && Number.isFinite(Date.parse(e.sceneUTC)) ? e.sceneUTC : null
      seen.add(id)
      // Build an allowlisted record. Never spread a browser-supplied object into a live AI turn.
      return [{ id, at: Number(e.at), question, answer, contextStamp, siteName, sceneUTC, source: e.source as ConversationEntry['source'], restored: true }]
    })
  } catch { return [] }
}

export function readCompanionHistory(storage: BrowserStorage | null = browserStorage()) {
  try { return parseCompanionHistory(storage?.getItem(COMPANION_HISTORY_KEY) ?? null) } catch { return [] }
}

export function appendConversation(entries: ConversationEntry[], entry: ConversationEntry): ConversationEntry[] {
  if (entries.some(e => e.id === entry.id)) return entries
  // Re-use the same validation and field allowlist for live and restored text.
  const clean = parseCompanionHistory(JSON.stringify({ v: 1, entries: [entry] }))[0]
  return clean ? [...entries, { ...clean, restored: false }].slice(-MAX_COMPANION_HISTORY) : entries
}

export function writeCompanionHistory(entries: ConversationEntry[], storage: BrowserStorage | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    if (!entries.length) storage.removeItem(COMPANION_HISTORY_KEY)
    else {
      const clean = entries.slice(-MAX_COMPANION_HISTORY).flatMap(entry => parseCompanionHistory(JSON.stringify({ v: 1, entries: [entry] }))).map(({ restored: _restored, ...entry }) => entry)
      let document = JSON.stringify({ v: 1, entries: clean })
      while (document.length > MAX_DOCUMENT_LENGTH && clean.length > 1) { clean.shift(); document = JSON.stringify({ v: 1, entries: clean }) }
      storage.setItem(COMPANION_HISTORY_KEY, document)
    }
    return true
  } catch { return false }
}
