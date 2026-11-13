// Shared, mutable landing telemetry. The 3D sequence writes it every frame; the DOM overlay
// reads it in its own animation frame. Nothing here causes React re-renders.
import type { LandingPoint } from './landingProfile.ts'

export type LandingTelemetry = LandingPoint & {
  /** Lander position on screen (0..1), or null when off-screen or behind the camera. */
  screen: { x: number; y: number } | null
  /** Distance from the camera to the lander, metres. */
  distanceM: number
}
export const landingStore: { telemetry: LandingTelemetry | null; skipRequested: boolean } = { telemetry: null, skipRequested: false }
export function requestLandingSkip() { landingStore.skipRequested = true }
