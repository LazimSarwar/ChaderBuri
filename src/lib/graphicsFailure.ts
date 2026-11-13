// What went wrong with the 3D view, in plain language, and what the visitor can do. Pure, so it can be tested.
// The original error is kept for the technical details; nothing here replaces it with a guess.

export type GraphicsFailureKind = 'webgl-unavailable' | 'context-lost' | 'asset' | 'exception'
export type GraphicsFailure = {
  kind: GraphicsFailureKind
  /** The original error, as thrown ("Name: message"), or a description of the event. */
  error: string
  /** First lines of the stack or component stack, when available. */
  stack?: string
  at: string
  renderer: string | null
  webgl2: boolean
}
/** Retries per page session: enough for a transient GPU reset, never a loop. */
export const MAX_SCENE_RETRIES = 2

export function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

/**
 * Classify from evidence only: the live WebGL probe decides "unavailable"; explicit context-loss and loading errors
 * decide those kinds; anything else is an application error with its own message.
 */
export function classifyFailure(error: unknown, probe: { webgl2: boolean; renderer: string | null }, now = new Date()): GraphicsFailure {
  const text = errorText(error)
  const stack = error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 6).join('\n') : undefined
  const kind: GraphicsFailureKind = !probe.webgl2 ? 'webgl-unavailable'
    : /context.?lost|CONTEXT_LOST_WEBGL|isContextLost/i.test(text) ? 'context-lost'
      : /failed to fetch|networkerror|could not load|failed to load|load failed|\bHTTP \d{3}|status \d{3}|\b404\b/i.test(text) ? 'asset'
        : 'exception'
  return { kind, error: text, stack, at: now.toISOString(), renderer: probe.renderer, webgl2: probe.webgl2 }
}

export type FailureCopy = { title: string; explain: string; retry: boolean; restartBrowser: boolean }
/** Plain-language explanation. Retrying in low quality is offered only where it can help. */
export function failureCopy(kind: GraphicsFailureKind, retriesLeft: number): FailureCopy {
  const left = retriesLeft > 0
  switch (kind) {
    case 'webgl-unavailable': return {
      title: '3D graphics are turned off in this browser',
      explain: 'The browser cannot create any WebGL context, so no 3D view can start here at any quality. Browsers do this after repeated graphics-process crashes or when hardware acceleration is off. Restart the browser (close every window), or open the page in another browser. Your mission plan and all calculations still work.',
      retry: false, restartBrowser: true,
    }
    case 'context-lost': return {
      title: 'The graphics processor reset the 3D view',
      explain: left ? 'The 3D view lost its graphics context and did not get it back. Retrying rebuilds it in Low quality, which asks much less of the GPU. Your mission plan and all calculations are unaffected.' : 'The 3D view lost its graphics context again. Restart the browser to reset the graphics process. Your mission plan and all calculations are unaffected.',
      retry: left, restartBrowser: !left,
    }
    case 'asset': return {
      title: 'Part of the 3D view could not load',
      explain: left ? 'A file the 3D view needs did not load. Retrying loads it again in Low quality. Your mission plan and all calculations are unaffected.' : 'A file the 3D view needs still did not load. Check the connection, then reload the page. Your mission plan and all calculations are unaffected.',
      retry: left, restartBrowser: false,
    }
    default: return {
      title: 'The 3D view stopped with an error',
      explain: left ? 'The 3D view hit an unexpected error. Retrying rebuilds it in Low quality. Your mission plan and all calculations are unaffected.' : 'The 3D view failed again after retrying. Reload the page; if it keeps happening, the technical details below help diagnose it.',
      retry: left, restartBrowser: false,
    }
  }
}
