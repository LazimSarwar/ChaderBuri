import { useSyncExternalStore } from 'react'
import type { QualityReport } from './fieldJourney'

/** Presentation diagnostics: never route through the application or mission state. */
export function createQualityStore() {
  let value: QualityReport | null = null
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    publish(next: QualityReport) {
      if (value && value.level === next.level && value.auto === next.auto && value.dpr === next.dpr && Math.abs(value.frameMs - next.frameMs) < 2) return
      value = next
      listeners.forEach(fn => fn())
    },
  }
}
export type QualityStore = ReturnType<typeof createQualityStore>
const empty = () => null, idle = () => () => {}
export function useQuality(store?: QualityStore, fallback: QualityReport | null = null) {
  return useSyncExternalStore(store?.subscribe ?? idle, store?.getSnapshot ?? empty, empty) ?? fallback
}
