import { memo } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Footprints, Home, MapPin, Navigation } from 'lucide-react'
import { OVERLAY_TEXT, type OverlayMode } from './fieldJourney'
import { contourInterval, contourSegments, createGrid, fillGridRows, hillshade, type HeightGrid, type TerrainSampler } from './terrainGrid'
import { clampToRadius, distanceText, scaleBarMetres } from './fieldMath'
import type { FieldPlace } from './fieldPlaces'
import { OverlayLegend } from './OverlayLegend'
import type { TerrainOverlayInfo } from '../lib/overlayMath'

type Props = {
  sampler: TerrainSampler | null
  visitor: { eastM: number; northM: number; heading: number }
  radiusM: number
  places: FieldPlace[]
  walkTarget: { eastM: number; northM: number; label: string } | null
  onWalkTo: (target: { eastM: number; northM: number; label: string; standoffM: number }) => void
  onAddMarker: (eastM: number, northM: number) => void
  /** The ground overlay drawn in the 3D view around you. */
  overlay: OverlayMode
  onOverlay: (mode: OverlayMode) => void
  /** The DEM product the scene reported, e.g. "LOLA …, 5 m pixels". */
  demProduct: string
  /** What the overlay reports it draws (contour step, range, DEM product and resolution); null while off. */
  overlayInfo?: TerrainOverlayInfo | null
  route?: { points: { eastM: number; northM: number; label: string }[]; onAdd: (eastM: number, northM: number) => void; editing: boolean }
  resolutionM?: number
}
const ZOOMS = { area: { halfM: 262, stepM: 2, label: 'Whole area · 500 m' }, near: { halfM: 40, stepM: 0.5, label: 'Near · 80 m' } } as const
type Zoom = keyof typeof ZOOMS
const ROWS_PER_FRAME = 14, RECOMPUTE_MOVE_M = 10

// Finished grids survive closing the panel: keyed by the sampler that produced them.
const gridCache = new WeakMap<TerrainSampler, Partial<Record<Zoom, { grid: HeightGrid; at: { eastM: number; northM: number } }>>>()

function useHeightGrid(sampler: TerrainSampler | null, visitor: { eastM: number; northM: number }, zoom: Zoom, resolutionM: number) {
  const [grid, setGrid] = useState<HeightGrid | null>(() => sampler ? gridCache.get(sampler)?.[zoom]?.grid ?? null : null)
  const [progress, setProgress] = useState(0)
  const [anchor, setAnchor] = useState(() => ({ eastM: visitor.eastM, northM: visitor.northM }))
  // No finer than the display needs or coarser than the DEM, but at least ~80 cells across so the near view stays
  // smooth: about 1 m near and 6.5 m for the whole area on a 20 m DEM.
  const stepM = Math.max(ZOOMS[zoom].stepM, Math.min(10, resolutionM, ZOOMS[zoom].halfM / 40))
  // Recompute when the sampler changes or the visitor has moved more than 10 m since the last pass.
  useEffect(() => {
    if (Math.hypot(visitor.eastM - anchor.eastM, visitor.northM - anchor.northM) > RECOMPUTE_MOVE_M) setAnchor({ eastM: visitor.eastM, northM: visitor.northM })
  }, [visitor.eastM, visitor.northM, anchor])
  useEffect(() => {
    if (!sampler) { setGrid(null); return }
    const cached = gridCache.get(sampler)?.[zoom]
    if (cached && cached.grid.stepM === stepM && Math.hypot(cached.at.eastM - anchor.eastM, cached.at.northM - anchor.northM) <= RECOMPUTE_MOVE_M) { setGrid(cached.grid); setProgress(1); return }
    const { halfM } = ZOOMS[zoom], next = createGrid(0, 0, halfM, stepM)
    let row = 0, frame = 0, alive = true
    const work = () => {
      if (!alive) return
      row = fillGridRows(next, sampler, row, row + ROWS_PER_FRAME)
      setProgress(row / next.n)
      if (row < next.n) frame = requestAnimationFrame(work)
      else { gridCache.set(sampler, { ...gridCache.get(sampler), [zoom]: { grid: next, at: anchor } }); setGrid(next) }
    }
    setProgress(0); frame = requestAnimationFrame(work)
    return () => { alive = false; cancelAnimationFrame(frame) }
  }, [sampler, anchor, zoom, stepM])
  return { grid: grid && Math.abs(grid.westM + ZOOMS[zoom].halfM) < 1e-6 ? grid : null, progress }
}

/** Survey map of the rendered LOLA terrain around the landing point, in thin contour lines over a soft hillshade. */
function TerrainMapView(p: Props) {
  const [zoom, setZoom] = useState<Zoom>('area')
  const { grid, progress } = useHeightGrid(p.sampler, p.visitor, zoom, p.resolutionM ?? 2)
  const HALF_M = ZOOMS[zoom].halfM
  const canvas = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(360)
  const [mode, setMode] = useState<'walk' | 'mark'>('walk')
  const markerId = useId(), markerNorth = useRef<HTMLInputElement>(null)
  const [markerEast, setMarkerEast] = useState('0'), [markerNorthValue, setMarkerNorthValue] = useState('0')
  const [markerError, setMarkerError] = useState(''), [markerStatus, setMarkerStatus] = useState('')
  const markerRadius = Math.max(0, p.radiusM - 1)
  const resetMarkerFeedback = () => { markerNorth.current?.setCustomValidity(''); setMarkerError(''); setMarkerStatus('') }
  useEffect(() => {
    const node = box.current; if (!node) return
    const observer = new ResizeObserver(([entry]) => setSize(Math.max(200, Math.round(entry.contentRect.width))))
    observer.observe(node); return () => observer.disconnect()
  }, [])
  const contours = useMemo(() => {
    if (!grid || !grid.known) return null
    const interval = contourInterval(grid.min, grid.max, 18)
    return { interval, lines: contourSegments(grid, interval), shade: hillshade(grid) }
  }, [grid])
  useEffect(() => {
    const c = canvas.current; if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1), px = Math.round(size * dpr)
    c.width = px; c.height = px
    const ctx = c.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, px, px)
    if (!grid || !contours) return
    const n = grid.n, img = new ImageData(n, n)
    for (let k = 0; k < n * n; k++) {
      const v = contours.shade[k]
      if (Number.isNaN(v)) continue
      img.data[k * 4] = 10 + v * 44; img.data[k * 4 + 1] = 16 + v * 58; img.data[k * 4 + 2] = 20 + v * 66; img.data[k * 4 + 3] = 255
    }
    const off = document.createElement('canvas'); off.width = n; off.height = n
    off.getContext('2d')?.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = true
    const cell = px / (2 * HALF_M) * grid.stepM
    ctx.drawImage(off, -cell / 2, -cell / 2, n * cell, n * cell)
    for (const { level, segments } of contours.lines) {
      const index = Math.abs(Math.round(level / contours.interval)) % 5 === 0
      ctx.strokeStyle = index ? 'rgba(214,244,250,.62)' : 'rgba(170,226,238,.3)'
      ctx.lineWidth = (index ? 1.1 : .7) * dpr
      ctx.beginPath()
      for (let s = 0; s < segments.length; s += 4) {
        ctx.moveTo(segments[s] * cell, segments[s + 1] * cell); ctx.lineTo(segments[s + 2] * cell, segments[s + 3] * cell)
      }
      ctx.stroke()
    }
  }, [grid, contours, size])

  const k = (2 * HALF_M) / size // metres per CSS pixel
  const pick = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const e = -HALF_M + (event.clientX - rect.left) / rect.width * 2 * HALF_M, n = HALF_M - (event.clientY - rect.top) / rect.height * 2 * HALF_M
    const point = clampToRadius(e, n, p.radiusM - 1)
    if (p.route) { if (p.route.editing) p.route.onAdd(point.eastM, point.northM); return }
    if (mode === 'walk') p.onWalkTo({ eastM: point.eastM, northM: point.northM, label: 'the map point', standoffM: 0 })
    else p.onAddMarker(point.eastM, point.northM)
  }
  const bar = scaleBarMetres(2 * HALF_M)
  const fmtH = (h: number) => `${Math.round(h).toLocaleString('en-GB')} m`
  const icon = (place: FieldPlace) => {
    const x = place.eastM, y = -place.northM, r = 5 * k
    if (place.kind === 'landing') return <g><circle cx={x} cy={y} r={r * 1.4} className="map-landing" /><path d={`M${x - r * 2.2} ${y}H${x + r * 2.2}M${x} ${y - r * 2.2}V${y + r * 2.2}`} className="map-landing" /></g>
    if (place.kind === 'lander') return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} className="map-lander" />
    if (place.kind === 'buri') return <circle cx={x} cy={y} r={r * .9} className="map-buri" />
    if (place.kind === 'flag') return <path d={`M${x} ${y}V${y - r * 2.4}L${x + r * 1.6} ${y - r * 1.8}L${x} ${y - r * 1.2}`} className="map-flag" />
    if (place.kind === 'photo') return <rect x={x - r * .8} y={y - r * .6} width={r * 1.6} height={r * 1.2} rx={r * .2} className="map-photo" />
    return <path d={`M${x} ${y}l${-r} ${-r * 1.6}a${r} ${r} 0 1 1 ${2 * r} 0z`} className="map-marker" />
  }
  // Name the fixed places; skip a label that would sit on top of one already drawn.
  const labelled: FieldPlace[] = []
  for (const pl of p.places) if ((pl.kind === 'landing' || pl.kind === 'lander' || pl.kind === 'buri') && labelled.every(q => Math.hypot(q.eastM - pl.eastM, q.northM - pl.northM) / k > 34)) labelled.push(pl)
  const lander = p.places.find(pl => pl.kind === 'lander'), landing = p.places.find(pl => pl.kind === 'landing')
  const go = (pl: FieldPlace | undefined) => pl && p.onWalkTo({ eastM: pl.eastM, northM: pl.northM, label: pl.label, standoffM: pl.standoffM })
  const loading = !p.sampler ? 'Waiting for measured terrain…' : !grid ? `Drawing terrain map… ${Math.round(progress * 100)}%` : !grid.known ? 'No terrain heights are available here.' : null
  return <div className="field-map">
    {loading && <p className="field-map-loading" role="status">{loading}</p>}
    {(p.route || mode === 'walk') && <div className="field-row field-map-return">
      <button className="field-button" disabled={!lander || lander.distanceM < lander.standoffM + 0.5} onClick={() => go(lander)}><Home size={14} aria-hidden="true" />Return to lander</button>
      <button className="field-button" disabled={!landing || landing.distanceM < 1.5} onClick={() => go(landing)}><Navigation size={14} aria-hidden="true" />Landing point</button>
    </div>}
    <div className="field-map-modes" role="radiogroup" aria-label="What a click on the map does">
      <button role="radio" aria-checked={mode === 'walk'} onClick={() => setMode('walk')}><Footprints size={14} aria-hidden="true" />Walk to point</button>
      <button role="radio" aria-checked={mode === 'mark'} onClick={() => setMode('mark')}><MapPin size={14} aria-hidden="true" />Add marker</button>
    </div>
    {!p.route && mode === 'mark' && <form className="field-map-marker-form field-note-form" aria-label="Place a marker by coordinates" onSubmit={event => {
      event.preventDefault()
      const eastM = Number(markerEast), northM = Number(markerNorthValue)
      if (!markerEast.trim() || !markerNorthValue.trim() || !Number.isFinite(eastM) || !Number.isFinite(northM)) return
      if (Math.hypot(eastM, northM) > markerRadius) {
        const message = `Choose a point within ${markerRadius} m of the landing point.`
        markerNorth.current?.setCustomValidity(message); setMarkerError(message); setMarkerStatus(''); markerNorth.current?.reportValidity(); return
      }
      p.onAddMarker(eastM, northM)
      setMarkerError(''); setMarkerStatus(`Marker placed at ${eastM} m east and ${northM} m north of the landing point.`)
    }}>
      
      <div className="field-map-marker-fields">
        <div className="field-map-marker-coordinate">
          <label htmlFor={markerId + '-east'} className="field-label">East (m)</label>
          <input id={markerId + '-east'} aria-label="Marker east (m)" type="number" step="any" min={-markerRadius} max={markerRadius} required value={markerEast} aria-describedby={markerId + '-help'} onChange={event => { resetMarkerFeedback(); setMarkerEast(event.target.value) }} />
        </div>
        <div className="field-map-marker-coordinate">
          <label htmlFor={markerId + '-north'} className="field-label">North (m)</label>
          <input ref={markerNorth} id={markerId + '-north'} aria-label="Marker north (m)" type="number" step="any" min={-markerRadius} max={markerRadius} required value={markerNorthValue} aria-describedby={markerId + '-help' + (markerError ? ' ' + markerId + '-error' : '')} aria-invalid={markerError ? true : undefined} onChange={event => { resetMarkerFeedback(); setMarkerNorthValue(event.target.value) }} />
        </div>
      </div>
      <button type="submit" className="field-button"><MapPin size={14} aria-hidden="true" />Place marker</button>
      <p id={markerId + '-help'} className="field-map-legend">Within {markerRadius} m of landing. Negative = west/south.</p>
      {markerError && <p id={markerId + '-error'} className="field-source" role="alert">{markerError}</p>}
      {markerStatus && <p className="field-source" role="status">{markerStatus}</p>}
    </form>}
    <div className="field-map-zoom" role="radiogroup" aria-label="Map scale">
      {(Object.keys(ZOOMS) as Zoom[]).map(z => <button key={z} role="radio" aria-checked={zoom === z} onClick={() => setZoom(z)}>{ZOOMS[z].label}</button>)}
    </div>
    <div ref={box} className="field-map-frame" data-ready={!!grid}>
      <canvas ref={canvas} style={{ width: size, height: size }} aria-hidden="true" />
      <svg viewBox={`${-HALF_M} ${-HALF_M} ${2 * HALF_M} ${2 * HALF_M}`} role="img" aria-label={`Terrain map, ${2 * HALF_M} metres across, north up. ${p.route ? p.route.editing ? 'Click to add a planned worksite; offset inputs provide a keyboard alternative.' : 'Route editing is locked during this preview.' : mode === 'walk' ? 'Click to walk to a point. The list below offers the same places.' : 'Click to place an observation marker, or use the marker coordinate fields above.'}`} onClick={pick} data-mode={mode}>
        <circle cx={0} cy={0} r={p.radiusM} className="map-boundary" />
        {p.route && <><polyline points={p.route.points.map(pt => `${pt.eastM},${-pt.northM}`).join(' ')} className="route-map-path" />{p.route.points.slice(1).map((pt, i) => <g key={i}><circle cx={pt.eastM} cy={-pt.northM} r={5 * k} className="route-map-station" /><text x={pt.eastM + 7 * k} y={-pt.northM - 6 * k} fontSize={11 * k} className="map-text">{pt.label}</text></g>)}</>}
        {p.walkTarget && <line x1={p.visitor.eastM} y1={-p.visitor.northM} x2={p.walkTarget.eastM} y2={-p.walkTarget.northM} className="map-route" />}
        {p.places.map(place => <g key={place.id}>{icon(place)}</g>)}
        {labelled.map(place => <text key={place.id} x={place.eastM + 8 * k} y={-place.northM + (place.kind === 'buri' ? 12 : place.kind === 'lander' ? -6 : 14) * k} fontSize={10.5 * k} className="map-text">{place.label}</text>)}
        {p.walkTarget && <circle cx={p.walkTarget.eastM} cy={-p.walkTarget.northM} r={6 * k} className="map-target" />}
        <g transform={`translate(${p.visitor.eastM} ${-p.visitor.northM}) rotate(${p.visitor.heading})`}>
          <path d={`M0 ${-9 * k}L${6 * k} ${7 * k}L0 ${3.5 * k}L${-6 * k} ${7 * k}Z`} className="map-visitor" />
        </g>
        <g className="map-north" transform={`translate(${HALF_M - 22 * k} ${-HALF_M + 26 * k})`}>
          <path d={`M0 ${-12 * k}L${5 * k} ${4 * k}L0 ${1 * k}L${-5 * k} ${4 * k}Z`} /><text y={16 * k} fontSize={10 * k} textAnchor="middle">N</text>
        </g>
        <g className="map-scale" transform={`translate(${-HALF_M + 16 * k} ${HALF_M - 16 * k})`}>
          <path d={`M0 ${-4 * k}V0H${bar}V${-4 * k}`} /><text x={bar / 2} y={-8 * k} fontSize={10 * k} textAnchor="middle">{bar} m</text>
        </g>
      </svg>
      {!p.sampler && <p className="field-map-status" role="status">The terrain map appears when the measured terrain under you has loaded.</p>}
      {p.sampler && !grid && <p className="field-map-status" role="status">Sampling the rendered terrain… {Math.round(progress * 100)}%</p>}
      {p.sampler && grid && !grid.known && <p className="field-map-status" role="status">No rendered terrain heights are available here yet.</p>}
    </div>
    <p className="field-map-legend">
      {grid && grid.known ? <>Elevation in view {fmtH(grid.min)} to {fmtH(grid.max)} · contours every {contours?.interval} m · {p.demProduct}</> : <>Contour lines and hillshade · {p.demProduct}</>}
      <span>Dashed circle: {p.radiusM} m exploration boundary · north up · arrow: you and your heading</span>
    </p>
    <h3 className="field-subhead">Ground overlay in the view</h3>
    <div className="field-segment" role="radiogroup" aria-label="Ground overlay in the 3D view">
      {(Object.keys(OVERLAY_TEXT) as OverlayMode[]).map(m => <button key={m} role="radio" aria-checked={p.overlay === m} onClick={() => p.onOverlay(m)}>{OVERLAY_TEXT[m].label}</button>)}
    </div>
    {p.overlay === 'off' ? <p className="field-map-legend" data-overlay="off">{OVERLAY_TEXT.off.legend}<span>Source: {p.demProduct}. Measured relief only; no composition or hazard data.</span></p>
      : <OverlayLegend variant="sheet" mode={p.overlay} info={p.overlayInfo ?? null} product={p.demProduct} />}
    <h3 className="field-subhead">Places</h3>
    <ul className="field-places">
      {p.places.map(place => <li key={place.id}>
        <span><strong>{place.label}</strong><small>{distanceText(place.distanceM)} away</small></span>
        <button className="field-button" disabled={place.distanceM < Math.max(1.5, place.standoffM + 0.5)} onClick={() => p.onWalkTo({ eastM: place.eastM, northM: place.northM, label: place.label, standoffM: place.standoffM })}>Walk here</button>
      </li>)}
    </ul>
  </div>
}

export const TerrainMap=memo(TerrainMapView)
