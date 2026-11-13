// Caption timing for Chader Buri in the field. Pure rules, used by FieldCompanion and verify:field.
// Actionable lines (an offer button, the welcome, objective prompts) stay until the visitor acts or dismisses.
// Ambient remarks fade on their own and never evict a pending actionable line.

export type CaptionKind = 'action' | 'ambient'
export type CaptionLike = { key: string; text: string; offer?: unknown; kind?: CaptionKind; group?: string }
export type CaptionState<L extends CaptionLike> = { pinned: L | null; queue: L[]; ambient: L | null }
export const MAX_PENDING = 3

export const emptyCaptions = <L extends CaptionLike>(): CaptionState<L> => ({ pinned: null, queue: [], ambient: null })
/** A line with an offer is actionable unless it says otherwise. */
export const lineKind = (l: CaptionLike): CaptionKind => l.kind ?? (l.offer ? 'action' : 'ambient')
/** How long an ambient remark stays: long enough to read slowly. Actionable lines have no timeout. */
export const ambientHoldMs = (text: string) => 6500 + text.length * 45
const sameGroup = (a: CaptionLike, b: CaptionLike) => a.key === b.key || (!!a.group && a.group === b.group)

/** A new line arrives. */
export function receiveLine<L extends CaptionLike>(s: CaptionState<L>, line: L): CaptionState<L> {
  if (lineKind(line) === 'ambient') return { ...s, ambient: line }
  // A newer line of the same group (the next objective step, a newer sky change) replaces the older one.
  if (!s.pinned || sameGroup(s.pinned, line)) return { ...s, pinned: line, queue: s.queue.filter(q => !sameGroup(q, line)) }
  return { ...s, queue: [...s.queue.filter(q => !sameGroup(q, line)), line].slice(-MAX_PENDING) }
}
/** The visitor acted on, or dismissed, the pinned line: the next pending one takes its place. */
export function resolvePinned<L extends CaptionLike>(s: CaptionState<L>): CaptionState<L> {
  const [next, ...rest] = s.queue
  return { ...s, pinned: next ?? null, queue: rest }
}
/** An ambient remark timed out (or was dismissed). Only that remark goes. */
export function expireAmbient<L extends CaptionLike>(s: CaptionState<L>, key: string): CaptionState<L> {
  return s.ambient?.key === key ? { ...s, ambient: null } : s
}
/** Lines of a group no longer apply (the visitor chose free exploration, the objective moved on). */
export function dropGroup<L extends CaptionLike>(s: CaptionState<L>, group: string): CaptionState<L> {
  const keep = (l: L | null) => !l || l.group !== group
  const queue = s.queue.filter(keep)
  if (keep(s.pinned)) return queue.length === s.queue.length ? s : { ...s, queue }
  const [next, ...rest] = queue
  return { ...s, pinned: next ?? null, queue: rest }
}

/** Lines with the same words said within this window are not repeated (a replay is the visitor's choice). */
export const REPEAT_WINDOW_MS = 90_000
const words = (text: string) => text.toLowerCase().replace(/\.(?!\d)/g, ' ').replace(/[^a-z0-9°.]+/g, ' ').trim()
/**
 * De-duplication: true when the same text (ignoring punctuation and case) was shown within the window.
 * `history` maps normalised text to the time it was last shown and is updated when the line is new.
 */
export function isRepeat(history: Map<string, number>, text: string, now: number, windowMs = REPEAT_WINDOW_MS) {
  const k = words(text), at = history.get(k)
  if (at !== undefined && now - at < windowMs) return true
  history.set(k, now)
  if (history.size > 60) for (const [key, t] of history) if (now - t >= windowMs) history.delete(key)
  return false
}
/** Lines the visitor has not seen yet because another surface covers the captions (a phone with a sheet open). */
export const waitingCount = <L extends CaptionLike>(s: CaptionState<L>) => (s.pinned ? 1 : 0) + s.queue.length
