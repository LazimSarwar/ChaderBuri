// When may a pointer drag in the 3D scene aim the example equipment instead of turning the view?
// Pure so the rule can be tested directly (scripts/verify_field.ts).

export type AdjustableEquipment = 'panel' | 'antenna'

export type EquipmentGesture = {
  object: AdjustableEquipment
  /** Mouse/pen button that started the press (0 = primary; touch reports 0). */
  button: number
  /** The instrument is set up (not packed away). */
  deployed: boolean
  /** Fully unfolded and drawn in the view (not hidden, mid-deployment or behind the HUD). */
  visible: boolean
  /** The instrument whose card is open, if any. */
  active: string | null | undefined
  /** The instrument whose "Aim by dragging" mode is on, if any. */
  adjusting: AdjustableEquipment | null
  /** Pointer lock is active (the mouse turns the head; there is no cursor to drag with). */
  pointerLocked: boolean
}

/**
 * Ordinary dragging always looks around. A drag aims an instrument only when the visitor has deliberately chosen
 * it: its card is open AND its "Aim by dragging" mode is on, it is deployed and fully visible, the pointer is free,
 * and the primary button started the press.
 */
export function equipmentDragAllowed(g: EquipmentGesture) {
  return g.button === 0 && g.deployed && g.visible && g.active === g.object && g.adjusting === g.object && !g.pointerLocked
}
