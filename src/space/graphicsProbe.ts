// One-off graphics capability probe, shared by startup quality and failure diagnosis.
// It creates at most one tiny WebGL context per check and releases it immediately (WEBGL_lose_context), so
// diagnostics never accumulate contexts. The result is cached; a re-check is explicit (after a failure or retry).
import type { QualityLevel } from './renderQuality'

export type GraphicsProbe = {
  /** WebGL 2 is available (three.js needs it for the 3D view). */
  webgl2: boolean
  /** Any WebGL (1 or 2) is available. */
  webgl: boolean
  /** Unmasked renderer string when the browser exposes it, e.g. "ANGLE (Intel, Intel(R) UHD Graphics 630 …)". */
  renderer: string | null
  gpu: GpuClass
}
export type GpuClass = 'software' | 'integrated' | 'discrete-or-unknown' | 'none'

/** Classify a renderer string. Software rasterisers and integrated GPUs start the scene conservatively. */
export function classifyRenderer(renderer: string | null | undefined): GpuClass {
  if (!renderer) return 'discrete-or-unknown'
  if (/swiftshader|basic render|llvmpipe|softpipe|software/i.test(renderer)) return 'software'
  // Apple silicon GPUs are integrated but capable; leave them to the frame-time controller.
  if (/apple (m\d|gpu)/i.test(renderer)) return 'discrete-or-unknown'
  if (/intel|uhd|iris|hd graphics|mali|adreno|powervr|videocore|vivante/i.test(renderer)) return 'integrated'
  return 'discrete-or-unknown'
}

/**
 * The level 'auto' starts at, before any frame is measured. Measured on an Intel UHD 630: the scene is fill-rate
 * bound and high needs about 34–43 ms of GPU per frame at 1440×900, so integrated GPUs start at balanced and
 * software rasterisers at low; the frame-time controller then adjusts as before.
 */
export function startQuality(gpu: GpuClass, hardwareConcurrency: number | undefined, deviceMemoryGb: number | undefined, compact: boolean): QualityLevel {
  if (gpu === 'software') return 'low'
  const lowSpec = (hardwareConcurrency ?? 8) <= 4 || (deviceMemoryGb ?? 8) <= 4
  if (gpu === 'integrated' || compact || lowSpec) return 'balanced'
  return 'high'
}

let cached: GraphicsProbe | null = null
/** Probe once (cached). Pass `fresh` to re-check after a failure. */
export function probeGraphics(fresh = false): GraphicsProbe {
  if (cached && !fresh) return cached
  const out: GraphicsProbe = { webgl2: false, webgl: false, renderer: null, gpu: 'none' }
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    let gl: WebGL2RenderingContext | WebGLRenderingContext | null = canvas.getContext('webgl2')
    if (gl) out.webgl2 = true
    else gl = document.createElement('canvas').getContext('webgl')
    if (gl) {
      out.webgl = true
      try { const info = gl.getExtension('WEBGL_debug_renderer_info'); out.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) } catch { /* renderer string withheld */ }
      out.gpu = classifyRenderer(out.renderer)
      // Release the probe context at once: browsers cap live contexts, and a failing GPU must not be given more.
      try { gl.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* released with the canvas */ }
    }
  } catch { /* getContext threw: no WebGL */ }
  cached = out
  return out
}
