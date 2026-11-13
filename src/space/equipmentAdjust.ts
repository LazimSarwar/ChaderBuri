// The one instrument (if any) in "Aim by dragging" mode, shared by its card (which switches it) and the scene
// (which only lets that instrument take a drag). Opening another card, closing the card or leaving ends it.
import { useSyncExternalStore } from 'react'
import type { AdjustableEquipment } from '../lib/equipmentGesture'

let adjusting: AdjustableEquipment | null = null
const listeners = new Set<() => void>()

export const getEquipmentAdjust = () => adjusting
export function setEquipmentAdjust(object: AdjustableEquipment | null) {
  if (adjusting === object) return
  adjusting = object
  for (const listener of listeners) listener()
}
export function useEquipmentAdjust() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, getEquipmentAdjust, getEquipmentAdjust)
}
