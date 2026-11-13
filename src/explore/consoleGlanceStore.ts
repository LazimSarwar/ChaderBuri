import type { AntennaMission } from './antennaMission.ts'
export type ConsoleGlance = { visitKey: string; siteName: string; arrivalUTC: string; sceneUTC: string; verdict: string; next: string; link: string; battery: string; timeline: string[]; ranking: string[]; antennaMission?: AntennaMission | null }
const empty: ConsoleGlance = { visitKey: '', siteName: '', arrivalUTC: '', sceneUTC: '', verdict: 'Loading mission', next: 'Events loading', link: 'Not assessed', battery: 'Not assessed', timeline: [], ranking: [], antennaMission: null }
let snapshot: ConsoleGlance = empty, serial = 0
export const newGlanceVisitKey = () => `visit-${++serial}`
/** An early headset entry must never show another visit's verdict or equipment. */
export function glanceForVisit(value: ConsoleGlance, visitKey: string, siteName: string): ConsoleGlance {
  return value.visitKey === visitKey ? value : { ...empty, visitKey, siteName, next: 'Open Mission tools to load readouts' }
}
const listeners = new Set<() => void>()
export const consoleGlanceStore = {
  getSnapshot: () => snapshot,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
  publish(next: ConsoleGlance) { if (JSON.stringify(snapshot) === JSON.stringify(next)) return; snapshot = next; listeners.forEach(fn => fn()) },
}
