import { useRef, type ReactNode } from 'react'
import { Html } from '@react-three/drei'
import { declutterCandidates, type ScreenRect } from '../lib/overlayMath'
import './overlay.css'

export type LabelSlot = { id: string; className?: string; content: ReactNode }
/** A label anchor in screen pixels (bottom centre of the label); `alts` are other anchors tried in order when it is crowded. */
export type LabelPlacement = { id: string; x: number; y: number; opacity: number; scale: number; priority: number; text?: string; alts?: { x: number; y: number }[]; owner?: string }
type Node = { el: HTMLDivElement; w: number; h: number; key: string; text?: string }
export type LabelNodes = Map<string, Node>
/** Areas no label may cover: projected hardware and HUD panels (`owner` lets a thing keep its own label). */
export type LabelBlock = ScreenRect & { owner?: string }

const ZERO = () => [0, 0]
const NOOP = () => {}

/**
 * One DOM layer for a set of scene labels (instead of one drei Html per label). Labels are positioned in screen
 * pixels by `placeLabels` from a pre-render hook; they never take pointer events, so the scene stays clickable.
 */
export function LabelLayer({ slots, nodes, className }: { slots: LabelSlot[]; nodes: React.RefObject<LabelNodes>; className?: string }) {
  return <Html calculatePosition={ZERO} onOcclude={NOOP} zIndexRange={[12, 10]} wrapperClass={'overlay-labels ' + (className ?? '')} style={{ pointerEvents: 'none' }}>
    {slots.map(slot => <div key={slot.id} className={'ovl-label ' + (slot.className ?? '')} style={{ visibility: 'hidden' }} ref={el => {
      if (el) nodes.current.set(slot.id, { el, w: 0, h: 0, key: '' })
      else nodes.current.delete(slot.id)
    }}>{slot.content}</div>)}
  </Html>
}

export function useLabelNodes() { return useRef<LabelNodes>(new Map()) }

/**
 * Writes positions, fades and the declutter result; DOM is touched only where something changed. Higher priority
 * labels choose first; a label moves to an alternative anchor or hides rather than overlap another label, a blocked
 * area or the edge of the view.
 */
export function placeLabels(nodes: LabelNodes, placements: LabelPlacement[], blocked: LabelBlock[] = [], view?: { width: number; height: number }) {
  const shown = new Set<string>()
  const live = placements.filter(p => p.opacity > .02 && nodes.has(p.id))
  for (const p of live) {
    const n = nodes.get(p.id)!
    if (p.text !== undefined && p.text !== n.text) {
      const target = n.el.querySelector<HTMLElement>('[data-text]') ?? n.el
      target.textContent = p.text; n.text = p.text; n.w = 0
    }
  }
  // Batch text writes before measuring any label; a multi-label update needs one layout, not one per label.
  for (const p of live) { const n = nodes.get(p.id)!; if (!n.w) { n.w = n.el.offsetWidth; n.h = n.el.offsetHeight } }
  const chosen = declutterCandidates(live.map(p => {
    const n = nodes.get(p.id)!, h = n.h * p.scale
    return { candidates: [{ x: p.x, y: p.y }, ...(p.alts ?? [])].map(c => ({ x: c.x, y: c.y - h / 2 })), w: n.w * p.scale, h, priority: p.priority }
  }), 4, blocked, view ? { ...view, margin: 2 } : undefined, live.map(p => p.owner))
  live.forEach((p, i) => {
    const c = chosen[i]
    if (c < 0) return
    shown.add(p.id)
    const n = nodes.get(p.id)!, at = c === 0 ? p : p.alts![c - 1]
    const key = `${at.x.toFixed(1)}|${at.y.toFixed(1)}|${p.opacity.toFixed(2)}|${p.scale.toFixed(2)}`
    if (key === n.key) return
    n.key = key
    n.el.style.transform = `translate3d(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px,0) translate(-50%,-100%) scale(${p.scale.toFixed(3)})`
    n.el.style.opacity = p.opacity.toFixed(2)
    n.el.style.visibility = 'visible'
  })
  for (const [id, n] of nodes) if (!shown.has(id) && n.key !== 'hidden') { n.key = 'hidden'; n.el.style.visibility = 'hidden' }
}

/**
 * Rectangles of the field HUD panels in canvas pixels, re-read at most every `everyMs` (layout reads are cheap at that
 * rate). Empty outside the field view.
 */
export function hudBlocks(cache: { at: number; blocks: LabelBlock[] }, canvas: HTMLElement, selectors: readonly string[], everyMs = 400): LabelBlock[] {
  const now = performance.now()
  if (now - cache.at < everyMs) return cache.blocks
  cache.at = now
  const hud = document.querySelector('.field-hud')
  if (!hud) { cache.blocks = []; return cache.blocks }
  const origin = canvas.getBoundingClientRect(), out: LabelBlock[] = []
  for (const el of hud.querySelectorAll(selectors.join(','))) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    out.push({ x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2, w: r.width, h: r.height })
  }
  cache.blocks = out
  return out
}
