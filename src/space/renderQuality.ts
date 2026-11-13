/**
 * Render quality for the surface visit: presentation only. A level trades pixel density, shadow-map size,
 * decorative soil shader detail and the share of illustrative rocks drawn; measured terrain, Sun and Earth
 * directions are identical at every level.
 */
export type QualityLevel = 'high' | 'balanced' | 'low'
export type QualitySetting = 'auto' | QualityLevel
export type QualityReport = { level: QualityLevel; auto: boolean; frameMs: number; dpr: number }

export type QualityPlan = {
  /** Device pixel ratio ceiling and floor applied to the canvas. */
  dpr: number
  /** Sunlight shadow map size (texels per side). */
  shadowMap: number
  /** Terrain soil shader detail: 2 every layer, 1 without the finest grain and craterlets, 0 broad layers only. */
  terrainDetail: 0 | 1 | 2
  /** Share of the illustrative rocks drawn (the rest are skipped, never moved). */
  rockShare: number
}

const ORDER: QualityLevel[] = ['low', 'balanced', 'high']

/** The concrete settings for a level on this device. */
export function qualityPlan(level: QualityLevel, deviceDpr: number, compact: boolean): QualityPlan {
  const device = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1
  if (level === 'high') return { dpr: Math.min(Math.max(1, device), compact ? 1.5 : 1.75), shadowMap: compact ? 1024 : 1536, terrainDetail: 2, rockShare: 1 }
  // The scene is fill-rate bound on integrated GPUs (measured: half the pixels, about a third of the GPU time), so
  // each step down must also shed pixels: on a 1x screen balanced draws 0.9 CSS px (0.81x the pixels), low 0.75.
  if (level === 'balanced') return { dpr: device > 1 ? Math.min(device, compact ? 1.15 : 1.25) : device * (compact ? 1 : .9), shadowMap: 1024, terrainDetail: 1, rockShare: .6 }
  // Phones keep a full CSS pixel (already a third of their screen density); larger screens may go below it.
  return { dpr: Math.min(1, device) * (compact ? 1 : .75), shadowMap: 512, terrainDetail: 0, rockShare: .32 }
}

/** Where 'auto' starts: lower-spec devices and phones start balanced, others high. */
export function initialQuality(hardwareConcurrency: number | undefined, deviceMemoryGb: number | undefined, compact: boolean): QualityLevel {
  const lowSpec = (hardwareConcurrency ?? 8) <= 4 || (deviceMemoryGb ?? 8) <= 4
  return compact || lowSpec ? 'balanced' : 'high'
}

/** Mean frame time (ms) above which 'auto' steps down from a level. */
export const STEP_DOWN_MS: Record<QualityLevel, number> = { high: 24, balanced: 30, low: Infinity }
/** Mean frame time (ms) at or below which a level is holding the display rate (vsync caps the measurement). */
export const STEP_UP_MS = 17.6
const WINDOW = 45
const UP_HOLD_MS = 10000

/**
 * Sustained frame-time controller with hysteresis. Feed it the gap between rendered frames on consecutive
 * animation ticks only (the canvas renders on demand, so idle gaps and key-repeat gaps must not be fed). It steps down after
 * a window whose mean exceeds the level's threshold, and steps up only after holding the display rate for a
 * while; every failed step up doubles that wait and two failures stop further attempts.
 */
export class QualityController {
  level: QualityLevel
  frameMs = 0
  private samples: number[] = []
  private steadySince = 0
  private steadyWindows = 0
  private failures = 0
  private raisedAt = 0
  constructor(start: QualityLevel) { this.level = start }
  /** Returns true when the level changed. */
  sample(gapMs: number, now: number): boolean {
    if (!(gapMs > 0) || gapMs > 1000) return false
    this.samples.push(gapMs)
    if (this.samples.length < WINDOW) return false
    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    this.samples.length = 0
    this.frameMs = mean
    const index = ORDER.indexOf(this.level)
    if (mean > STEP_DOWN_MS[this.level] && index > 0) {
      // A step up that fails within a short while counts against further attempts.
      if (this.raisedAt && now - this.raisedAt < 8000) this.failures++
      this.raisedAt = 0
      this.level = ORDER[index - 1]
      this.steadySince = 0
      this.steadyWindows = 0
      return true
    }
    if (mean <= STEP_UP_MS && index < ORDER.length - 1 && this.failures < 2) {
      // Both wall time and rendered windows: an idle canvas never earns a step up.
      if (!this.steadySince) this.steadySince = now
      this.steadyWindows++
      if (now - this.steadySince >= UP_HOLD_MS * 2 ** this.failures && this.steadyWindows >= 8 * 2 ** this.failures) {
        this.level = ORDER[index + 1]
        this.steadySince = 0
        this.steadyWindows = 0
        this.raisedAt = now
        return true
      }
    } else { this.steadySince = 0; this.steadyWindows = 0 }
    return false
  }
}

/** Additional fill-rate relief after auto reaches Low. Does not touch scientific geometry or HTML text.
 * Windows reject stalls and idle gaps. Once reduced, resolution recovers only after ten seconds of inexpensive frames;
 * this avoids repeatedly reallocating render targets every time the visitor stops walking. */
export class SurfaceResolutionController {
  dpr: number
  private sum = 0
  private count = 0
  private changedAt = 0
  private steadySince = 0
  readonly ceiling: number
  readonly floor: number
  constructor(ceiling: number, floor: number = Math.min(ceiling, .75)) { this.ceiling = ceiling; this.floor = floor; this.dpr = ceiling }
  sample(gapMs: number, now: number): boolean {
    if (!Number.isFinite(gapMs) || gapMs <= 0 || gapMs > 250) { this.resetWindow(); return false }
    this.sum += gapMs; this.count++
    if (this.count < 45) return false
    const mean = this.sum / this.count
    this.resetWindow()
    if(mean < 20 && this.dpr < this.ceiling){
      if(!this.steadySince)this.steadySince=now
      if(now-this.steadySince>=10000&&now-this.changedAt>=10000){this.dpr=Math.min(this.ceiling,Math.round((this.dpr+.1)*100)/100);this.changedAt=now;this.steadySince=0;return true}
      return false
    }
    this.steadySince=0
    if (mean <= 30 || now - this.changedAt < 2500 || this.dpr <= this.floor) return false
    this.dpr = Math.max(this.floor, Math.round((this.dpr - .1) * 100) / 100)
    this.changedAt = now
    return true
  }
  resetWindow(): void { this.sum = 0; this.count = 0 }
}
