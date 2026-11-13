import { useLayoutEffect, useRef } from 'react'
import { HUD_SURFACES, overlayLegend, placeLegend, type Rect, type TerrainOverlayInfo } from '../lib/overlayMath'
import type { OverlayMode } from './fieldJourney'

type Props = {
  mode: OverlayMode
  info: TerrainOverlayInfo | null
  /** DEM product the field knows before the overlay reports (e.g. "LOLA …, 5 m pixels"). */
  product: string
  /** 'hud': its own spot in the field view; 'sheet': inline in the terrain map. */
  variant: 'hud' | 'sheet'
  hidden?: boolean
}

/**
 * The one legend for the ground overlay, the same layout in every mode and in both places it appears: what the
 * colour means (none, stepped slope bands or the elevation ramp, all from one ramp), the contour line key, the DEM
 * product and resolution, and what the reading is not.
 */
export function OverlayLegend({ mode, info, product, variant, hidden }: Props) {
  const ref = useRef<HTMLElement>(null)
  useLegendSlot(ref, variant === 'hud' && mode !== 'off' && !hidden, `${mode}|${info?.contourStepM}|${info?.minM}|${info?.maxM}|${info?.product}`)
  if (mode === 'off' || (variant === 'hud' && hidden)) return null
  const l = overlayLegend(mode, info, product)
  return <section ref={ref} className="field-overlay-legend" data-variant={variant} data-mode={mode} aria-label="Ground overlay legend">
    <strong>{l.title}</strong>
    {l.key.kind === 'bands' && <div className="field-ovl-bands" aria-label="Slope bands in degrees">
      {l.key.stops.map(s => <span key={s.label}><i style={{ background: s.colour }} />{s.label}</span>)}<span className="field-ovl-end">{l.key.end}</span>
    </div>}
    {l.key.kind === 'ramp' && <div className="field-ovl-ramp" aria-label={`Elevation from ${l.key.from} to ${l.key.to}`}>
      <i style={{ background: `linear-gradient(90deg, ${l.key.colours.join(',')})` }} /><span>{l.key.from}</span><span>{l.key.to}</span>
    </div>}
    <div className="field-ovl-lines"><span><i data-line="minor" />{l.lines.minor}</span><span><i data-line="index" />{l.lines.index}</span></div>
    <p className="field-ovl-source">{l.source}</p>
    <p className="field-ovl-note">{l.note}</p>
  </section>
}

/**
 * Places the HUD legend in the first free spot (see placeLegend) from the measured HUD panels, re-measuring when any
 * panel mounts, unmounts or changes size. Hidden (not overlapping) when no spot is free.
 */
function useLegendSlot(ref: React.RefObject<HTMLElement | null>, active: boolean, contentKey: string) {
  useLayoutEffect(() => {
    const el = ref.current, hud = el?.closest<HTMLElement>('.field-hud')
    if (!active || !el || !hud || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const others = HUD_SURFACES.filter(s => s !== '.field-overlay-legend').join(',')
    const measure = () => {
      frame = 0
      const box = hud.getBoundingClientRect()
      const rel = (r: DOMRect): Rect => ({ left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top })
      const find = (sel: string) => { const e = hud.querySelector(sel); const r = e?.getBoundingClientRect(); return r && r.width > 0 ? rel(r) : null }
      const obstacles = [...hud.querySelectorAll(others)].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0).map(rel)
      el.dataset.compact = 'false'; const full = { w: el.offsetWidth, h: el.offsetHeight }
      el.dataset.compact = 'true'; const compact = { w: el.offsetWidth, h: el.offsetHeight }
      const style = getComputedStyle(hud), edge = parseFloat(style.getPropertyValue('--f-edge')) || 16
      // The left column starts below the status card (the HUD's measured --f-left-top) and any objective/activity card.
      const cards = find('.field-objective'), leftTop = Math.max(parseFloat(style.getPropertyValue('--f-left-top')) || 0, cards ? cards.bottom + 10 : 0)
      const slot = placeLegend({ width: box.width, height: box.height, edge, full, compact, toolbar: find('.field-strip'), corner: find('.field-corner'), obstacles,
        leftTop: leftTop || undefined, compactFirst: box.width <= 760 })
      if (!slot) { el.dataset.placed = 'none'; el.style.visibility = 'hidden'; return }
      el.dataset.compact = String(slot.compact); el.dataset.placed = slot.anchor
      el.style.left = `${slot.left}px`; el.style.top = `${slot.top}px`; el.style.visibility = 'visible'
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule), watched = new Set<Element>()
    const watch = () => { for (const e of hud.querySelectorAll(others)) if (!watched.has(e)) { watched.add(e); resize.observe(e) } schedule() }
    const mutations = new MutationObserver(watch)
    resize.observe(hud); mutations.observe(hud, { childList: true }); watch()
    return () => { resize.disconnect(); mutations.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [ref, active, contentKey])
}
