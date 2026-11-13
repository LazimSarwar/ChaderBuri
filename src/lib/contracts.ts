// Shared contracts between the 3D scene, the Mission Visor, Chader Buri's interface and the
// AI companion request. Keep these small and serialisable.
import type { GuideAction } from './guideAction.ts'

/** Phases of the time-compressed landing simulation (illustrative, not flight telemetry). */
export type LanderPhase = 'approach' | 'hazard-scan' | 'terminal' | 'contact' | 'shutdown' | 'landed'

/**
 * The one canonical lander transform. The landing simulation writes it; the lander exhibit,
 * plume, dust, visor markers and the character all read it. Local site frame, metres:
 * east/north from the landing anchor, altitude above the ground at the landed spot.
 */
export type LanderState = {
  phase: LanderPhase
  eastM: number
  northM: number
  altM: number
  /** Nose-up tilt of the thrust axis away from local vertical, degrees. */
  pitchDeg: number
  /** Bearing the tilt points toward (the direction of travel), degrees from north. */
  headingDeg: number
  /** 0 = fixed descent stance, 1 = measured ground-contact stance. Blends after contact. */
  legStance: number
  /** Engine plume intensity, 0 to 1. */
  plume: number
  /** Seconds since the landing sequence started. */
  t: number
}

/** How a number was obtained; shown beside every instrument value. */
export type ReadingKind = 'measured' | 'calculated' | 'estimated' | 'illustrative'
export type ReadingStatus = 'ok' | 'warn' | 'fail' | 'none'

export type VisorReading = {
  id: string
  label: string
  value: string
  unit: string
  kind: ReadingKind
  source: string
  assumption?: string
  status: ReadingStatus
}

/** Readouts currently visible on a screen, sent with a question so "this number" resolves. */
export type ScreenDigestItem = { id: string; label: string; value: string; unit?: string; status?: ReadingStatus; source?: string }
export type ScreenDigest = { screen: string; items: ScreenDigestItem[] }

/** An operation Chader Buri proposes on her own; it runs only after the user presses Allow. */
export type GuideSuggestion = { action: GuideAction; reason: string }

/** Stable key for remembering a dismissed suggestion during the session. */
export const suggestionKey = (action: GuideAction) => `${action.kind}:${action.value}`

export const MAX_DIGEST_ITEMS = 30
const clip = (value: string, n: number) => value.length > n ? value.slice(0, n - 1) + '…' : value
const STATUSES: ReadingStatus[] = ['ok', 'warn', 'fail']
/** Bound and sanitise a digest; used by the browser store and again by the server. */
export function cleanDigestItems(items: unknown): ScreenDigestItem[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, MAX_DIGEST_ITEMS).filter(i => i && typeof i === 'object').map(raw => {
    const i = raw as Record<string, unknown>
    const status = STATUSES.includes(i.status as ReadingStatus) ? i.status as ReadingStatus : undefined
    return {
      id: clip(String(i.id ?? ''), 40), label: clip(String(i.label ?? ''), 80), value: clip(String(i.value ?? ''), 80),
      ...(i.unit ? { unit: clip(String(i.unit), 20) } : {}),
      ...(status ? { status } : {}),
      ...(i.source ? { source: clip(String(i.source), 80) } : {}),
    }
  }).filter(i => i.label && i.value)
}
