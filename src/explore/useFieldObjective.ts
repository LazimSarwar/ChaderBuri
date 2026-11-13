import { useCallback, useEffect, useState } from 'react'
import { advanceObjective, newObjective, OBJECTIVE_STORAGE_KEY, parseObjectiveStore, type ObjectiveInput, type ObjectiveProgress, type ObjectiveStore } from './fieldObjective'

const read = (): ObjectiveStore => { try { return parseObjectiveStore(localStorage.getItem(OBJECTIVE_STORAGE_KEY)) } catch { return {} } }

/** The first-objective progress for one site, saved on this device. Storage failures keep it in memory. */
export function useFieldObjective(siteSlug: string, input: ObjectiveInput, sceneUTC: string) {
  const [store, setStore] = useState<ObjectiveStore>(read)
  const progress = store[siteSlug] ?? newObjective()
  const set = useCallback((change: (p: ObjectiveProgress) => ObjectiveProgress) => setStore(all => {
    const before = all[siteSlug] ?? newObjective(), after = change(before)
    return after === before ? all : { ...all, [siteSlug]: after }
  }), [siteSlug])
  useEffect(() => { try { localStorage.setItem(OBJECTIVE_STORAGE_KEY, JSON.stringify(store)) } catch { /* in-memory only */ } }, [store])
  // Steps complete from live conditions (heading, position, the antenna's computed pointing).
  const { heading, earth, skylineEl, visitor, antenna } = input
  useEffect(() => { set(p => advanceObjective(p, input, sceneUTC)) },
    [Math.round(heading), earth.az.toFixed(2), earth.el.toFixed(2), skylineEl, visitor.eastM.toFixed(1), visitor.northM.toFixed(1), antenna.deployed, antenna.earthVisible, antenna.pointingErrorDeg.toFixed(2), set])
  return {
    progress,
    setFree: useCallback((free: boolean) => set(p => ({ ...p, free, collapsed: free ? p.collapsed : false })), [set]),
    setCollapsed: useCallback((collapsed: boolean) => set(p => ({ ...p, collapsed })), [set]),
    restart: useCallback(() => set(() => newObjective()), [set]),
  }
}
