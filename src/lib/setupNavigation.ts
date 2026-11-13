import type { IntakeValidation } from './missionIntake.ts'

export type SetupFieldError = { name: string; message: string }
export type SetupNavigation = { step: number; errors: string[]; fields: string[] }

/** Navigation only. Later-step fields never block returning to the step that can repair them. */
export function nextSetupStep(step: number, currentErrors: SetupFieldError[], validation: IntakeValidation): SetupNavigation {
  if (currentErrors.length) return { step, errors: currentErrors.map(e => e.message), fields: currentErrors.map(e => e.name) }
  if (step < 2) return { step: step + 1, errors: [], fields: [] }
  // The existing whole-draft validator still guards the actual comparison. A coverage change can
  // invalidate an earlier date while the visitor is on equipment; return to its editable fields.
  if (!validation.ok) return { step: 0, errors: validation.errors, fields: [] }
  return { step: 3, errors: [], fields: [] }
}
