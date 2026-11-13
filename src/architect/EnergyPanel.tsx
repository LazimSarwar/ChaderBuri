import { powerTradeoffs } from './tradeoffs.ts'
import type { Ephemeris, EphRow, Horizon } from '../data'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BatteryCharging, CalendarPlus, Download, ArrowRight, Thermometer } from 'lucide-react'
import { downloadIcs, windowIcs } from '../lib/ics'
import { DEFAULT_POWER, generationFor, simulatePower, type PowerConfig } from './power.ts'
import { DEFAULT_THERMAL, simulateThermal, type ThermalConfig } from './thermal.ts'
import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from './solver.ts'
import { Explain, Term } from '../Explain'
import { DSN_MASK_DEG, XB_BUDGET_DEFAULTS, dsnPasses, loadDsnGeometry, precomputedElevation, xbLinkBudget, xbMaxDataRateKbps, type DsnGeometry } from '../lib/dsn'
import { TIMING_LIMITATION, longestRunOverlapping, worstBlock } from '../lib/attribution'
import { exportSnapshot } from '../lib/exportSnapshot'
import type { PredictionIndex } from '../lib/predictionIndex'
import type { RobustnessAssessment } from './robustness'

const inputClass = 'w-full rounded-md border border-edge bg-paper px-2 py-1.5 font-mono text-xs text-ink'

function NumberField({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void
}) {
  return <label className="block text-[12px] text-inkdim">{label}
    <input className={inputClass + ' mt-1'} type="number" value={value} min={min} max={max} step={step}
      onChange={(e) => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange(Math.max(min, Math.min(max, e.target.valueAsNumber))) }} />
  </label>
}

export function PowerControls({ value, onChange }: { value?: PowerConfig; onChange: (v: PowerConfig | undefined) => void }) {
  const remembered = useRef(value ?? DEFAULT_POWER)
  if (value) remembered.current = value
  const set = <K extends keyof PowerConfig>(key: K, v: PowerConfig[K]) => onChange({ ...(value ?? DEFAULT_POWER), [key]: v })
  return <fieldset className="rounded-xl border border-viable/30 bg-viable/[0.04] p-3">
    <legend className="px-1 text-[12px] font-semibold uppercase tracking-widest text-viable">Power & battery</legend>
    <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={!!value}
      onChange={(e) => onChange(e.target.checked ? { ...remembered.current } : undefined)} /> Require battery reserve</label>
    {value ? <>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="Panel area (m²)" value={value.panelAreaM2} min={0} max={100} step={0.1} onChange={(v) => set('panelAreaM2', v)} />
        <NumberField label="Demand (W)" value={value.loadW} min={0} max={10000} step={10} onChange={(v) => set('loadW', v)} />
        <NumberField label="Battery (Wh)" value={value.capacityWh} min={1} max={1000000} step={500} onChange={(v) => set('capacityWh', v)} />
        <NumberField label="Reserve (%)" value={value.reservePct} min={0} max={100} onChange={(v) => set('reservePct', v)} />
      </div>
      <label className="mt-3 block text-[12px] text-inkdim">Panel orientation
        <select className={inputClass + ' mt-1'} value={value.orientation} onChange={(e) => set('orientation', e.target.value as PowerConfig['orientation'])}>
          <option value="tracking">Ideal Sun tracking</option><option value="horizontal">Horizontal</option><option value="fixed">Fixed tilt & azimuth</option>
        </select>
      </label>
      {value.orientation === 'fixed' && <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="Tilt from level (°)" value={value.tiltDeg} min={0} max={180} onChange={(v) => set('tiltDeg', v)} />
        <NumberField label="Facing azimuth (°)" value={value.azimuthDeg} min={0} max={359} onChange={(v) => set('azimuthDeg', v)} />
      </div>}
      <details className="mt-3 text-[12px] text-inkdim"><summary className="cursor-pointer text-ink">Efficiency & initial charge</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField label="Cell efficiency (%)" value={value.efficiencyPct} min={1} max={100} onChange={(v) => set('efficiencyPct', v)} />
          <NumberField label="Initial charge (%)" value={value.initialPct} min={0} max={100} onChange={(v) => set('initialPct', v)} />
          <NumberField label="Charge efficiency (%)" value={value.chargeEfficiencyPct} min={1} max={100} onChange={(v) => set('chargeEfficiencyPct', v)} />
          <NumberField label="Discharge efficiency (%)" value={value.dischargeEfficiencyPct} min={1} max={100} onChange={(v) => set('dischargeEfficiencyPct', v)} />
        </div>
      </details>
      <p className="mt-3 text-[12px] leading-relaxed text-inkdim">Illustrative hardware. Demand includes your assumed heaters and payloads. Tracking assumes perfect pointing; temperature, ageing, and peak current limits are not modeled.</p>
    </> : <p className="mt-2 text-[12px] text-inkdim">Visibility screening only. Enable to include hourly electrical energy balance in every landing result.</p>}
  </fieldset>
}

export function ThermalControls({ value, powerOn, onChange }: { value?: ThermalConfig; powerOn: boolean; onChange: (v: ThermalConfig | undefined) => void }) {
  const remembered = useRef(value ?? DEFAULT_THERMAL)
  if (value) remembered.current = value
  const set = <K extends keyof ThermalConfig>(key: K, v: ThermalConfig[K]) => {
    const next = { ...(value ?? DEFAULT_THERMAL), [key]: v }
    // Preserve validateThermal's invariants so a live edit can't crash the solver:
    // survival ≤ setpoint and sink < setpoint.
    if (next.survivalK > next.setpointK) { if (key === 'survivalK') next.setpointK = next.survivalK; else next.survivalK = next.setpointK }
    if (next.sinkK >= next.setpointK) { if (key === 'sinkK') next.setpointK = next.sinkK + 1; else next.sinkK = next.setpointK - 1 }
    onChange(next)
  }
  return <fieldset className="rounded-xl border border-sun/30 bg-sun/[0.04] p-3">
    <legend className="px-1 text-[12px] font-semibold uppercase tracking-widest text-sun">Night survival</legend>
    {!powerOn ? <p className="mt-2 text-[12px] text-inkdim">Enable power &amp; battery first — survival heaters draw from the same battery.</p> : <>
      <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={!!value}
        onChange={(e) => onChange(e.target.checked ? { ...remembered.current } : undefined)} /> Require thermal survival</label>
      {value ? <>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField label="Hold setpoint (°C)" value={Math.round(value.setpointK - 273.15)} min={-150} max={80} onChange={(v) => set('setpointK', v + 273.15)} />
          <NumberField label="Survival floor (°C)" value={Math.round(value.survivalK - 273.15)} min={-150} max={80} onChange={(v) => set('survivalK', v + 273.15)} />
          <NumberField label="Heater max (W)" value={value.heaterMaxW} min={0} max={5000} step={5} onChange={(v) => set('heaterMaxW', v)} />
          <NumberField label="Sink temp (K)" value={value.sinkK} min={0} max={273} onChange={(v) => set('sinkK', v)} />
        </div>
        <details className="mt-3 text-[12px] text-inkdim"><summary className="cursor-pointer text-ink">Thermal mass &amp; surfaces</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberField label="Thermal mass (kJ/K)" value={Math.round(value.thermalMassJK / 1000)} min={1} max={10000} step={10} onChange={(v) => set('thermalMassJK', v * 1000)} />
            <NumberField label="Radiator εA (m²)" value={value.radiativeCoeffM2} min={0} max={20} step={0.05} onChange={(v) => set('radiativeCoeffM2', v)} />
            <NumberField label="Solar αA (m²)" value={value.absorptivityAreaM2} min={0} max={20} step={0.05} onChange={(v) => set('absorptivityAreaM2', v)} />
            <NumberField label="Internal heat (% load)" value={value.internalHeatFraction} min={0} max={100} onChange={(v) => set('internalHeatFraction', v)} />
          </div>
        </details>
        <p className="mt-3 text-[12px] leading-relaxed text-inkdim">Single-node lumped model. Sink temperature is a representative Diviner-range assumption, not a per-site measurement. Survival and setpoint are generic, not vehicle specifications.</p>
      </> : <p className="mt-2 text-[12px] text-inkdim">Heaters hold the lander through darkness; the draw is added to battery demand.</p>}
    </>}
  </fieldset>
}

const limits = { lit: 'sunlight percentage', dark: 'longest darkness', link: 'Earth visibility', gap: 'Earth visibility gap', battery: 'battery reserve', thermal: 'survival temperature' }
/** Kelvin to a rounded Celsius label. */
const degC = (k: number) => `${Math.round(k - 273.15)} °C`
export function explain(ev: Evaluated, c: Constraints): string {
  const clauses: string[] = []
  if (!ev.ok.lit) clauses.push(`sunlight is ${ev.litPct.toFixed(1)}%, below your ${c.minLitPct}% limit`)
  if (!ev.ok.dark) clauses.push(`darkness lasts ${ev.longestDarkH} h, above your ${c.maxDarkH} h limit`)
  if (!ev.ok.link) clauses.push(`Earth visibility is ${ev.linkPct.toFixed(1)}%, below your ${c.minLinkPct}% limit`)
  if (!ev.ok.gap) clauses.push(`Earth is masked for ${ev.longestGapH} h, above your ${c.maxGapH} h limit`)
  if (ev.thermal && c.thermal && !ev.thermal.pass) {
    clauses.push(`electronics reach ${degC(ev.thermal.minTempK)} against a ${degC(c.thermal.survivalK)} survival limit`)
  }
  if (ev.power && c.power && !ev.power.pass) {
    clauses.push(`battery reaches ${ev.power.minPct.toFixed(1)}% against a ${c.power.reservePct}% reserve`)
    if (ev.power.unmetWh > 1e-8) clauses.push(`${ev.power.unmetWh.toFixed(0)} Wh of demand cannot be supplied`)
  }
  if (clauses.length) return `Misses requirements: ${clauses.join('; ')}.`
  const slack = ev.limiting === 'thermal' && c.thermal && ev.thermal ?
    `${(ev.thermal.minTempK - c.thermal.survivalK).toFixed(0)} K above survival` :
    ev.limiting === 'battery' && c.power && ev.power ?
    (ev.power.minPct - c.power.reservePct < 0.05
      ? `exactly at the ${c.power.reservePct}% reserve — no engineering margin added`
      : `${(ev.power.minPct - c.power.reservePct).toFixed(1)} percentage points above reserve`) :
    ev.limiting === 'lit' ? `${(ev.litPct - c.minLitPct).toFixed(1)} percentage points above minimum` :
    ev.limiting === 'link' ? `${(ev.linkPct - c.minLinkPct).toFixed(1)} percentage points above minimum` :
    ev.limiting === 'dark' ? `${c.maxDarkH - ev.longestDarkH} h below the limit` : `${c.maxGapH - ev.longestGapH} h below the limit`
  return `Meets every enabled requirement. Tightest constraint: ${limits[ev.limiting]} — ${slack}.`
}

export function EnergyPanel({ series, name, row, constraints: c, startMs, recommended, onOpen, onApplyPower, evidence, onShare, shareStatus, earthRows, datasetIndex,robustness }: {
  robustness: RobustnessAssessment
  datasetIndex: PredictionIndex
  series: SiteSeries; name: string; row: number; constraints: Constraints; startMs: number; recommended: boolean; onOpen: () => void
  onApplyPower: (c: PowerConfig) => void
  evidence: { sun: Ephemeris['provenance']; earth: Ephemeris['provenance']; terrain: Horizon }
  onShare: () => void; shareStatus: string; earthRows: EphRow[]
}) {
  const earthAz = useMemo(() => Float64Array.from(earthRows, (r) => r.az), [earthRows])
  const earthEl = useMemo(() => Float64Array.from(earthRows, (r) => r.el), [earthRows])
  const end = row + Math.round(c.missionDays * 24)
  const ev = useMemo(() => evaluateWindow(series, row, end, c), [series, row, end, c])
  const thermalRun = useMemo(() => c.thermal && c.power ? simulateThermal(series.solar, row, end, c.thermal, c.power.loadW, true) : null, [series, row, end, c.thermal, c.power])
  const run = useMemo(() => c.power ? simulatePower(generationFor(series.solar, c.power), row, end, c.power, true, thermalRun?.heaterW) : null, [series, row, end, c.power, thermalRun])
  const sensitivity = useMemo(() => {
    const cases: { label: string; result: Evaluated | null }[] = [-6, 6].map((shift) => ({
      label: `Landing ${shift > 0 ? '+' : '−'}6 h`,
      result: row + shift >= 0 && end + shift <= series.hours ? evaluateWindow(series, row + shift, end + shift, c) : null,
    }))
    if (c.power) cases.push({ label: 'Demand +20%', result: evaluateWindow(series, row, end, { ...c, power: { ...c.power, loadW: c.power.loadW * 1.2 } }) })
    return cases
  }, [series, row, end, c])
  const tradeoffs = useMemo(() => c.power ? powerTradeoffs(series.solar, row, end, c.power, c.thermal) : [], [series, row, end, c.power, c.thermal])
  const [rfRequiredKbps, setRfRequiredKbps] = useState(128)
  const [rfAperture, setRfAperture] = useState<'34m' | '70m'>('34m')
  const [dsnGeo, setDsnGeo] = useState<DsnGeometry | null>(null)
  const [dsnSource, setDsnSource] = useState<'loading' | 'precomputed' | 'fallback'>('loading')
  useEffect(() => {
    let active = true
    loadDsnGeometry().then((g) => {
      if (!active) return
      setDsnGeo(g)
      setDsnSource(g ? 'precomputed' : 'fallback')
    })
    return () => { active = false }
  }, [])
  const date = (r: number) => new Date(startMs + r * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const eventTime = (hour: number | null) => hour === null ? 'None in this window' : `${date(row + hour)} (estimated)`
  const exportBrief = () => {
    const brief = {
      title: `Chader Buri mission brief — ${name}`, site: series.slug, landingUTC: date(row), endUTC: date(end),
      schemaVersion: 2, generatedUTC: new Date().toISOString(), reproducibility:exportSnapshot(datasetIndex,[series.slug]), evidence, tradeoffs, constraints: c, explanation: explain(ev, c), metrics: ev, batteryTimeline: run?.points ?? [], robustness,
      assessmentScope: { visibility: 'included', battery: c.power ? 'included' : 'not assessed', thermal: c.thermal ? 'included' : 'not assessed', rf: 'diagnostic only; excluded from nominal verdict', footprint: 'separate visibility/battery samples; excludes thermal and RF' },
      thermal: c.thermal ? { config: c.thermal, summary: ev.thermal, timeline: thermalRun?.points ?? [], model: 'Single-node lumped-capacitance survival model; heater draw folded into battery demand; sink temperature assumed, not per-site measured' } : null,
      communications: { targetKbps: rfRequiredKbps, aperture: rfAperture, geometrySource: dsnSource, diagnosticOnly: true, model: 'X-band BPSK rate-1/2 screening budget; diagnostic only, excluded from the pass/fail verdict; no DSN booking or antenna assignment' },
      sensitivity: sensitivity.map((s) => ({ scenario: s.label, pass: s.result?.pass ?? null, explanation: s.result ? explain(s.result, s.label === 'Demand +20%' && c.power ? { ...c, power: { ...c.power, loadW: c.power.loadW * 1.2 } } : c) : 'Outside cached coverage' })),
      timingLimitations: TIMING_LIMITATION,
      method: 'Hourly left-endpoint energy integration; six-hour candidate landing grid. Ranking maximizes minimum normalized constraint slack; not a probability of success.',
      assumptions: `1361 W/m² at 1 AU scaled by Horizons observer distance; apparent disc radii from Horizons; locally level ridge approximation. ${c.thermal ? 'Single-node lumped thermal survival model included (heater draw folded into battery demand); ageing and peak-current not modeled.' : 'No thermal, ageing or peak-current model.'} Earth-centre visibility is not a radio link budget; the X-band downlink figure is a separate diagnostic excluded from the pass/fail verdict. Terrain and ephemeris share four-decimal coordinates and DEM ground elevation.`,
      sources: ['https://ssd.jpl.nasa.gov/horizons/', 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm', 'https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science'],
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `chader-buri-${series.slug}-${row}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  // DSN ground-station contact, three distinct states per station per hour:
  //   'rf'  — RF-feasible contact: terrain DTE + station above mask (+ budget)
  //   'vis' — station sees the Moon above its mask, but no terrain DTE here
  //   'none'— station below its mask
  // Elevations come from the precomputed Horizons station geometry
  // (scripts/build_dsn_geometry.py) when the hour is in coverage; the
  // analytic Almanac fallback covers anything else.
  const linkAt = (h: number) => h >= 0 && h < series.hours && series.linkPrefix[h + 1] - series.linkPrefix[h] === 1
  const dsnRows = useMemo(() => {
    const names = ['Goldstone', 'Madrid', 'Canberra']
    const out: { s: ('rf' | 'vis' | 'none')[]; elev: number[]; reason: string[] }[] = []
    const selectedGt = rfAperture === '34m' ? XB_BUDGET_DEFAULTS.gtDbK34m : XB_BUDGET_DEFAULTS.gtDbK70m
    for (let h = row; h < end; h++) {
      const timeMs = startMs + h * 3600000
      const passes = dsnPasses(new Date(timeMs))
      const states: ('rf' | 'vis' | 'none')[] = []
      const elevs: number[] = []
      const reasons: string[] = []
      for (const n of names) {
        let elev: number | null = dsnGeo ? precomputedElevation(dsnGeo, n, timeMs) : null
        if (elev === null) elev = passes.find((p) => p.name === n)!.elevDeg
        elevs.push(elev)
        const visible = elev >= DSN_MASK_DEG
        const terrainClear = linkAt(h)
        const rangeKm = earthRows[h]?.rangeKm
        const budget = visible && terrainClear && rangeKm
          ? xbLinkBudget(rangeKm, elev, selectedGt, rfRequiredKbps)
          : null
        const feasible = visible && terrainClear && budget?.feasible === true
        states.push(feasible ? 'rf' : visible ? 'vis' : 'none')
        reasons.push(
          !visible ? 'station below 6° mask' :
          !terrainClear ? 'station sees Moon; lunar terrain blocks this site' :
          !budget?.feasible ? `geometry clears; ${rfRequiredKbps} kbps RF target not met` :
          `RF target met at ${rfRequiredKbps} kbps with ${rfAperture === '34m' ? '34 m BWG' : '70 m'} aperture`,
        )
      }
      out.push({ s: states, elev: elevs, reason: reasons })
    }
    return out
  }, [row, end, startMs, dsnGeo, series, earthRows, rfAperture, rfRequiredKbps])
  // Disclosed X-band budget: best pass per complex over the window
  const budget = useMemo(() => {
    const names = ['Goldstone', 'Madrid', 'Canberra']
    return names.map((label, si) => {
      let best = { rate34: 0, rate70: 0, elev: 0, at: -1 }
      dsnRows.forEach((r, k) => {
        const h = row + k
        const elev = r.elev[si]
        if (elev < XB_BUDGET_DEFAULTS.stationMaskDeg || !linkAt(h)) return
        const rangeKm = earthRows[h]?.rangeKm
        if (!rangeKm) return
        const rate34 = xbMaxDataRateKbps(rangeKm, elev, XB_BUDGET_DEFAULTS.gtDbK34m)
        if (rate34 > best.rate34) best = { rate34, rate70: xbMaxDataRateKbps(rangeKm, elev, XB_BUDGET_DEFAULTS.gtDbK70m), elev, at: h }
      })
      return { label, ...best }
    })
  }, [dsnRows, row, earthRows, series])
  // Gap attribution: name the blocking ridge for the longest dark and link gaps.
  const darkRun = longestRunOverlapping(series.darkRuns, row, end)
  const gapRun = longestRunOverlapping(series.gapRuns, row, end)
  const darkGap = darkRun ? worstBlock(series.solar.azimuth, series.solar.elevation, evidence.terrain, darkRun[0], darkRun[1]) : null
  const linkGap = gapRun && earthRows ? worstBlock(earthAz, earthEl, evidence.terrain, gapRun[0], gapRun[1]) : null
  const exportIcs = () => {
    const windowStart = startMs + row * 3600000
    downloadIcs(`chader-buri-${series.slug}-window.ics`, windowIcs({
      title: `Chader Buri landing window — ${name}`,
      startMs: windowStart, endMs: windowStart + c.missionDays * 24 * 3600_000,
      description: `Landing window from the Chader Buri mission architect. Sun centre visible ${ev.litPct.toFixed(1)}%, longest darkness ${ev.longestDarkH} h. Screening geometry, not a commitment.`,
    }))
  }
  const points = run?.points ?? []
  const x = (h: number) => 42 + h / (end - row) * 708
  const y = (pct: number) => 150 - pct * 1.2
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.hour).toFixed(2)},${y(p.socPct).toFixed(2)}`).join(' ')
  const peakW = Math.max(0, ...points.map((p) => p.generationW))
  const maxW = Math.max(1, c.power?.loadW ?? 0, peakW)
  const py = (w: number) => 245 - w / maxW * 55
  const powerPath = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.hour).toFixed(2)},${py(p.generationW).toFixed(2)}`).join(' ')
  return <section className="mt-4 rounded-2xl border border-viable/30 bg-gradient-to-br from-viable/[0.07] to-panel p-4" aria-label="Mission recommendation">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-viable"><BatteryCharging className="h-4 w-4" />{recommended ? ev.pass ? 'Recommended landing' : 'Closest available option' : 'Selected landing'}</p>
        <h3 className="mt-1 font-display text-xl text-ink">{name}</h3><p className="mt-1 font-mono text-[12px] text-inkdim">{date(row)} · {c.missionDays} days</p>
      </div>
      <div className="flex gap-2"><button onClick={exportBrief} className="flex items-center gap-1 rounded-md border border-edge px-2 py-2 text-[12px] text-ink"><Download className="h-3 w-3" /> Brief JSON</button>
        <button onClick={exportIcs} className="flex items-center gap-1 rounded-md border border-edge px-2 py-2 text-[12px] text-ink"><CalendarPlus className="h-3 w-3" /> Calendar .ics</button>
        <button onClick={onOpen} className="flex items-center gap-1 rounded-md border border-sun/40 bg-sun/10 px-2 py-2 text-[12px] text-sun">Open in scene <ArrowRight className="h-3 w-3" /></button></div>
    </div>
    <button className="mt-3 text-xs text-earth underline underline-offset-4" onClick={onShare}>{shareStatus}</button>
    <details className="mission-source mt-3"><summary>Data and assumptions supporting this result</summary>
      <p>Cached hourly JPL predictions · terrain horizon from {evidence.terrain.dem} · 1° azimuth sampling · 160 km terrain extent. Hardware values are your assumptions. A pass applies only to enabled model requirements.</p>
      <p>Export Brief JSON to inspect source queries, provenance, hardware settings, and sensitivity results. Earth visibility is geometry, not a radio-link guarantee.</p>
    </details>
    <p className="mt-3 text-[15px] leading-relaxed text-ink">{explain(ev, c)}</p>
    {(() => {
      // Compact assessment scope: what this verdict includes, at a glance. Anything
      // disabled reads "Not assessed"; RF is always a diagnostic outside the verdict.
      const visOk = ev.ok.lit && ev.ok.dark && ev.ok.link && ev.ok.gap
      const pill = (label: string, tone: 'pass' | 'fail' | 'diag' | 'na', detail: string) =>
        <span key={label} className={'rounded border px-2 py-1 ' + (tone === 'pass' ? 'border-viable/40 text-viable' : tone === 'fail' ? 'border-danger/40 text-danger' : tone === 'na' ? 'border-edge text-inkdim/70' : 'border-edge text-inkdim')}>
          <span className="font-semibold uppercase tracking-wide">{label}</span> {detail}
        </span>
      return <div className="mt-2 flex flex-wrap gap-1.5 text-[13px]" aria-label="Assessment scope">
        {pill('Visibility', visOk ? 'pass' : 'fail', `lit ${ev.litPct.toFixed(0)}% · link ${ev.linkPct.toFixed(0)}%`)}
        {c.power && ev.power ? pill('Battery', ev.power.pass ? 'pass' : 'fail', `min ${ev.power.minPct.toFixed(0)}% vs ${c.power.reservePct}% reserve`) : pill('Battery', 'na', 'Not assessed')}
        {c.thermal && ev.thermal ? pill('Thermal', ev.thermal.pass ? 'pass' : 'fail', `min ${degC(ev.thermal.minTempK)}`) : pill('Thermal', 'na', 'Not assessed')}
        {pill('RF', 'diag', 'diagnostic — not in verdict')}
        {pill('Footprint', 'diag', 'assessed separately below')}
      </div>
    })()}
    <p className="mt-2 text-[12px] leading-relaxed text-inkdim"><Term id="illumination">Sun centre visible</Term> {ev.litPct.toFixed(1)}% · <Term id="longest-dark">longest darkness</Term> {ev.longestDarkH} h{ev.longestDarkH >= 24 && <> (≈ {(ev.longestDarkH / 24).toFixed(1)} Earth days without sunlight)</>} · <Term id="dte">Earth visible</Term> {ev.linkPct.toFixed(1)}% · longest gap {ev.longestGapH} h.</p>
    <Explain>Read the two "longest" numbers against Earth: the longest night at mid-latitudes on Earth is about 15 h. Anything the battery must bridge here is measured in Earth days, which is why the array size and the landing date matter so much.</Explain>
    {(darkGap || linkGap) && <p className="mt-1 text-[12px] leading-relaxed text-inkdim">
      {darkGap && <>Deepest Sun block: {date(darkGap.i)} — Sun at {darkGap.bodyAz}°/{darkGap.bodyEl}° behind a {darkGap.maskDeg}° ridge. </>}
      {linkGap && <>Deepest Earth block: {date(linkGap.i)} — Earth at {linkGap.bodyAz}°/{linkGap.bodyEl}° behind a {linkGap.maskDeg}° ridge.</>}
    </p>}
    <p className="mt-1 text-[12px] leading-relaxed text-inkdim">{TIMING_LIMITATION}</p>
    {run && c.power && <>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Minimum charge', `${run.minPct.toFixed(1)}%`], ['Final charge', `${run.endPct.toFixed(1)}%`], ['Solar energy', `${(run.generatedWh / 1000).toFixed(1)} kWh`], ['Unmet demand', `${run.unmetWh.toFixed(0)} Wh`]].map(([label, value]) =>
          <div key={label}><p className="text-[12px] text-inkdim">{label}</p><p className="font-mono text-2xl text-ink">{value}</p></div>)}
      </div>
      <Explain>Minimum charge is the lowest the battery gets during the mission. It must stay above the {c.power.reservePct}% <Term id="reserve">reserve</Term> or the battery check fails. Unmet demand is energy the lander wanted but could not get.</Explain>
      <svg viewBox="0 0 780 275" className="mt-3 w-full" role="img" aria-label={`Battery charge over ${c.missionDays} days; minimum ${run.minPct.toFixed(1)} percent; reserve ${c.power.reservePct} percent`}>
        {[0, 50, 100].map((v) => <g key={v}><line x1="42" x2="750" y1={y(v)} y2={y(v)} stroke="var(--color-edge)" /><text x="4" y={y(v) + 4} fill="var(--color-inkdim)" fontSize="11">{v}%</text></g>)}
        <path d={`${path} L750,150 L42,150 Z`} fill="var(--color-viable)" opacity="0.12" />
        <path d={path} fill="none" stroke="var(--color-viable)" strokeWidth="2" />
        <line x1="42" x2="750" y1={y(c.power.reservePct)} y2={y(c.power.reservePct)} stroke="var(--color-danger)" strokeDasharray="5 4" />
        <text x="748" y={Math.max(14, y(c.power.reservePct) - 5)} textAnchor="end" fill="var(--color-danger)" fontSize="11">Reserve {c.power.reservePct}%</text>
        <text x="42" y="178" fill="var(--color-sun)" fontSize="11">Generation (W)</text><text x="748" y="178" textAnchor="end" fill="var(--color-inkdim)" fontSize="11">Dashed: demand {c.power.loadW} W · generation peak {peakW.toFixed(0)} W</text>
        <path d={powerPath} fill="none" stroke="var(--color-sun)" strokeWidth="1.3" />
        <line x1="42" x2="750" y1={py(c.power.loadW)} y2={py(c.power.loadW)} stroke="var(--color-inkdim)" strokeDasharray="5 4" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} x={x((end - row) * f)} y="267" textAnchor="middle" fill="var(--color-inkdim)" fontSize="11">Day {(c.missionDays * f).toFixed(1)}</text>)}
      </svg>
      {(() => {
        const n = dsnRows.length
        const w = 708 / n
        const labels = ['Goldstone', 'Madrid', 'Canberra']
        const fill = (s: 'rf' | 'vis' | 'none') =>
          s === 'rf' ? 'var(--color-earth)' : s === 'vis' ? 'color-mix(in srgb, var(--color-earth) 35%, var(--color-paper3))' : 'var(--color-paper3)'
        const rfHours = (i: number) => dsnRows.filter((d) => d.s[i] === 'rf').length
        return (
          <>
            <svg viewBox="0 0 780 46" className="mt-1 w-full" role="img"
              aria-label={`DSN contact states per hour: ${labels.map((l, i) => `${l} RF target met ${Math.round(100 * rfHours(i) / Math.max(1, n))}%`).join(', ')}`}>
              {labels.map((label, i) => (
                <g key={label}>
                  <text x="4" y={14 + i * 10} fill="var(--color-inkdim)" fontSize="11">{label[0]}</text>
                  {dsnRows.map((d, h) => (
                    <rect key={h} x={42 + h * w} y={8 + i * 10} width={Math.max(w, 0.8)} height={7}
                      fill={fill(d.s[i])}>
                      <title>{`${label} · ${d.reason[i]}`}</title>
                    </rect>
                  ))}
                </g>
              ))}
              <text x="748" y="44" textAnchor="end" fill="var(--color-inkdim)" fontSize="10.5">
                bright: RF target met · dim: geometry only · track: below 6° mask
              </text>
            </svg>
            <p className="mt-1 text-[12px] leading-relaxed text-inkdim">
              <span className="font-semibold text-ink">Diagnostic only.</span> The X-band downlink is a
              separate assessment — it does <span className="text-ink">not</span> affect the pass/fail
              verdict or ranking above, which use Earth-centre visibility, not a link budget.
            </p>
            <details className="mission-source mt-2">
              <summary>X-band downlink budget (diagnostic — excluded from the verdict)</summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <NumberField label="Target downlink (kbps)" value={rfRequiredKbps} min={1} max={5000} step={1} onChange={setRfRequiredKbps} />
                <label className="block text-[12px] text-inkdim">DSN receive aperture
                  <select className={inputClass + ' mt-1'} value={rfAperture} onChange={(e) => setRfAperture(e.target.value as '34m' | '70m')}>
                    <option value="34m">34 m BWG</option>
                    <option value="70m">70 m</option>
                  </select>
                </label>
              </div>
              <p className="mt-2">Geometry source: {dsnSource === 'precomputed' ? 'precomputed JPL Horizons station elevations' : dsnSource === 'loading' ? 'loading precomputed station elevations; analytic fallback active' : 'analytic fallback (precomputed product unavailable)'}.</p>
              <div className="benchmark-table-wrap">
                <table className="benchmark-table">
                  <caption>Best terrain-clear station pass · supported information rate after power and channel limits</caption>
                  <thead>
                    <tr><th>Complex</th><th>Best-pass elevation</th><th>Rate · 34 m BWG</th><th>Rate · 70 m</th><th>At (UT)</th></tr>
                  </thead>
                  <tbody>
                    {budget.map((b) => (
                      <tr key={b.label}>
                        <th>{b.label}</th>
                        <td>{b.at >= 0 ? `${b.elev.toFixed(1)}°` : '—'}</td>
                        <td>{b.at < 0 ? '—' : b.rate34 >= 1000 ? `${(b.rate34 / 1000).toFixed(2)} Mbps` : `${b.rate34.toFixed(0)} kbps`}</td>
                        <td>{b.at < 0 ? '—' : b.rate70 >= 1000 ? `${(b.rate70 / 1000).toFixed(2)} Mbps` : `${b.rate70.toFixed(0)} kbps`}</td>
                        <td>{b.at >= 0 ? date(b.at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2">
                X-band 8.4 GHz · lander EIRP {XB_BUDGET_DEFAULTS.landerEirpDbm} dBm (assumed) · pointing +
                implementation {XB_BUDGET_DEFAULTS.pointingLossDb} dB (assumed) · G/T {XB_BUDGET_DEFAULTS.gtDbK34m} dB/K (34 m BWG) and{' '}
                {XB_BUDGET_DEFAULTS.gtDbK70m} dB/K (70 m) at 45° and CD=0.50 — DSN 810-005 module 206E table 6;
                elevation scaling 10·log10(sin el / sin 45°) is a screening approximation · required Eb/N0{' '}
                {XB_BUDGET_DEFAULTS.requiredEbN0Db} dB + {XB_BUDGET_DEFAULTS.implementationMarginDb} dB margin (assumed) ·
                standard 1.4 MHz channel with idealized BPSK rate-1/2 caps information rate at 700 kbps.
                Ranges are the cached Earth distances; no forwarding, scheduling or antenna-assignment realism.
                Earth visibility is geometry, not a committed service.
              </p>
            </details>
          </>
        )
      })()}
      <div className="grid gap-2 text-[12px] text-inkdim sm:grid-cols-2"><p>First reserve breach: <span className="text-ink">{eventTime(run.firstReserveH)}</span></p><p>First unmet load: <span className="text-ink">{eventTime(run.firstUnmetH)}</span></p></div>
      <p className="mt-2 text-[12px] text-inkdim">Hourly estimates; event times interpolated within each constant-power hour. Curtailed {(run.curtailedWh / 1000).toFixed(2)} kWh · conversion losses {(run.lossesWh / 1000).toFixed(2)} kWh. Values after depletion assume the requested load continues.</p>
    </>}
    {thermalRun && c.thermal && (() => {
      const tpts = thermalRun.points
      const temps = tpts.map((p) => p.tempK)
      const tLo = Math.min(c.thermal.survivalK, c.thermal.sinkK, ...temps)
      const tHi = Math.max(c.thermal.setpointK, ...temps)
      const pad = Math.max(5, (tHi - tLo) * 0.1)
      const lo = tLo - pad, hi = tHi + pad
      const ty = (k: number) => 150 - ((k - lo) / (hi - lo)) * 130
      const tpath = tpts.map((p, i) => `${i ? 'L' : 'M'}${x(p.hour).toFixed(2)},${ty(p.tempK).toFixed(2)}`).join(' ')
      const froze = thermalRun.firstFreezeH !== null
      const tiles: [string, string][] = [
        ['Minimum temperature', degC(thermalRun.minTempK)],
        ['Heater energy', `${(thermalRun.heaterEnergyWh / 1000).toFixed(2)} kWh`],
        ['Survival floor', degC(c.thermal.survivalK)],
        ['Heater saturated', `${thermalRun.saturatedHours} h`],
      ]
      return <div className="mt-5 border-t border-edge pt-4">
        <h4 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-sun"><Thermometer className="h-4 w-4" />Night survival</h4>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(([label, value]) => <div key={label}><p className="text-[12px] text-inkdim">{label}</p><p className={'font-mono text-2xl ' + (froze ? 'text-danger' : 'text-ink')}>{value}</p></div>)}
        </div>
        <svg viewBox="0 0 780 165" className="mt-3 w-full" role="img" aria-label={`Node temperature over ${c.missionDays} days; minimum ${degC(thermalRun.minTempK)}; survival floor ${degC(c.thermal.survivalK)}`}>
          {[lo, (lo + hi) / 2, hi].map((v) => <g key={v}><line x1="42" x2="750" y1={ty(v)} y2={ty(v)} stroke="var(--color-edge)" /><text x="4" y={ty(v) + 4} fill="var(--color-inkdim)" fontSize="11">{Math.round(v - 273.15)}°</text></g>)}
          <path d={tpath} fill="none" stroke="var(--color-sun)" strokeWidth="2" />
          <line x1="42" x2="750" y1={ty(c.thermal.setpointK)} y2={ty(c.thermal.setpointK)} stroke="var(--color-inkdim)" strokeDasharray="5 4" />
          <text x="748" y={Math.max(14, ty(c.thermal.setpointK) - 5)} textAnchor="end" fill="var(--color-inkdim)" fontSize="11">Setpoint {degC(c.thermal.setpointK)}</text>
          <line x1="42" x2="750" y1={ty(c.thermal.survivalK)} y2={ty(c.thermal.survivalK)} stroke="var(--color-danger)" strokeDasharray="5 4" />
          <text x="748" y={Math.min(160, ty(c.thermal.survivalK) + 14)} textAnchor="end" fill="var(--color-danger)" fontSize="11">Survival {degC(c.thermal.survivalK)}</text>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} x={x((end - row) * f)} y="162" textAnchor="middle" fill="var(--color-inkdim)" fontSize="11">Day {(c.missionDays * f).toFixed(1)}</text>)}
        </svg>
        <p className="mt-2 text-[12px] leading-relaxed text-inkdim">
          {froze
            ? `Electronics fall below survival near ${thermalRun.firstFreezeH} h (estimated); the ${c.thermal.heaterMaxW} W heater saturates for ${thermalRun.saturatedHours} h. `
            : `Heaters hold ${degC(c.thermal.setpointK)} throughout; ${(thermalRun.heaterEnergyWh / 1000).toFixed(2)} kWh of heating is added to battery demand above. `}
          Single-node lumped model against a {c.thermal.sinkK} K radiative sink (representative Diviner-range assumption). Not a vehicle thermal design.
        </p>
      </div>
    })()}
    {c.power && <div className="mt-5 border-t border-edge pt-4">
      <h4 className="text-sm font-medium">What would make the electrical design work?</h4>
      <p className="mt-1 text-[12px] leading-5 text-inkdim">Each alternative changes one setting for this exact window. Values meet reserve and supply all modeled demand; they include no engineering margin. Visibility requirements remain separate.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{tradeoffs.map(t => <article key={t.key} className="rounded-xl border border-edge bg-void/50 p-3">
        <p className="text-[12px] text-inkdim">{t.label}</p><p className="mt-2 font-mono text-xl">{t.value === null ? 'No solution' : `${t.value.toLocaleString()} ${t.unit}`}</p>
        {t.value === null ? <p className="mt-2 text-[12px] leading-5 text-inkdim">{t.note}</p> : <button className="mt-3 text-xs text-earth underline underline-offset-4" onClick={() => onApplyPower({ ...c.power!, [t.key]: t.value! })}>Apply {t.label.toLowerCase()}</button>}
      </article>)}</div>
    </div>}
    <div className="mt-4 border-t border-edge pt-3"><p className="text-xs text-ink">Does this option tolerate a change?</p>
      <div className="mt-2 flex flex-wrap gap-2">{sensitivity.map((s) => <span key={s.label} title={s.result ? explain(s.result, s.label === 'Demand +20%' && c.power ? { ...c, power: { ...c.power, loadW: c.power.loadW * 1.2 } } : c) : 'Outside data coverage'} className={'rounded-md border px-2 py-1 text-[12px] ' + (s.result?.pass ? 'border-viable/30 text-viable' : 'border-edge text-inkdim')}>{s.label}: {s.result === null ? 'outside coverage' : s.result.pass ? 'passes' : 'fails'}</span>)}</div>
      <p className="mt-2 text-[12px] text-inkdim">These explicit scenarios are sensitivity checks, not confidence intervals. Ranking uses the smallest normalized margin across visibility and battery requirements; it is not a success probability.</p>
    </div>
  </section>
}
