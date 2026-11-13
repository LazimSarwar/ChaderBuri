import { useSyncExternalStore } from 'react'
import type { BriefTopic, GuideBrief, GuideFocus, MissionState } from './guideBriefs'
import type { CompareContext } from './lunarCompanion'

/**
 * Shared state between the dashboard and Chader Buri: the explanations she has given (authored, no AI),
 * what she is pointing at, and the last mission change she made (for Undo). Module stores, so any
 * dashboard component can ask her about a result without prop drilling.
 */
function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: T) => { value = next; listeners.forEach(l => l()) },
    use: () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => value),
  }
}

export type LoggedBrief = GuideBrief & { id: number; at: number }
const briefs = store<LoggedBrief[]>([])
export const useBriefs = briefs.use
export function postBrief(b: GuideBrief) { briefs.set([...briefs.get(), { ...b, id: Date.now() + Math.random(), at: Date.now() }].slice(-6)); if (b.focus) pointAt(b.focus) }
export function clearBriefs() { briefs.set([]) }

/** What Chader Buri is pointing at. `key` changes on every request so the same target can be shown again. */
export type Pointer = GuideFocus & { key: number }
const pointer = store<Pointer | null>(null)
export const usePointer = pointer.use
let fade: ReturnType<typeof setTimeout> | undefined
/** Point at something; the marker fades after 20 s so it never lingers on later work. */
export function pointAt(f: GuideFocus) {
  const p = { ...f, key: Date.now() + Math.random() }
  pointer.set(p)
  clearTimeout(fade); fade = setTimeout(() => { if (pointer.get()?.key === p.key) pointer.set(null) }, 20000)
}
export function clearPointer() { pointer.set(null) }

/** A dashboard button asking her about a result. The app turns it into an authored explanation. */
type Ask = { topic: BriefTopic | 'compare'; hour?: number }
const askListeners = new Set<(a: Ask) => void>()
export function askAbout(topic: BriefTopic | 'compare', hour?: number) { askListeners.forEach(l => l({ topic, hour })) }
export function onAsk(listener: (a: Ask) => void) { askListeners.add(listener); return () => { askListeners.delete(listener) } }

/** The two options on the Compare page, so her answers and highlights stay on them instead of the plan's mission. */
const compareFocus = store<CompareContext | null>(null)
export const useCompareFocus = compareFocus.use
export function setCompareFocus(f: CompareContext | null) { if (JSON.stringify(compareFocus.get()) !== JSON.stringify(f)) compareFocus.set(f) }

/** The last mission change she made, kept so it can be undone while the mission is still as she left it. */
export type GuideChange = { report: string; before: MissionState; after: MissionState; afterKey: string; at: number }
const change = store<GuideChange | null>(null)
export const useGuideChange = change.use
export const guideChange = change.get
export function recordChange(c: GuideChange | null) { change.set(c) }
