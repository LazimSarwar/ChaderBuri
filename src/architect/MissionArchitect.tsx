import { loadScenario, saveScenario, scenarioURL } from './scenario.ts'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useScreenDigest } from '../lib/screenDigest'
import { ArrowRight, CalendarRange, Check, Radio, Rocket, Sun, X } from 'lucide-react'
import { PowerControls, ThermalControls, EnergyPanel, explain } from './EnergyPanel'
import { DEFAULT_POWER } from './power.ts'
import { REFERENCE, referenceConstraints, referenceRow } from './reference'
import { Explain, Term } from '../Explain'
import { DispersionPanel } from './DispersionPanel'
import { HeightSensitivityPanel } from './HeightSensitivityPanel'
import { useRobustness } from './useRobustness'
import { buildMissionBrief,type MissionBrief } from './missionBrief'
import { PrintableBrief } from './PrintableBrief'
import { MissionCsvDownloads } from '../MissionCsvDownloads'
import { MissionViewControls } from './MissionViewControls'
import { ScenarioCompare, decodeScenarios, type Scn } from './ScenarioCompare'
import { FeasibilityCalendar } from './FeasibilityCalendar'
import { MissionQuestions } from './MissionQuestions'
import { verdictText } from './verdictText'
import { equipmentLine, publishMission } from '../lib/missionSummary'
import { siteSeries } from '../lib/seriesCache'
import { askAbout, clearPointer, usePointer } from '../lib/guideDesk'
import { BuriWhy } from './MomentTable'
import { CoverageMatrix, EvidenceButton } from './Evidence'
import type { EvidenceId } from '../lib/evidence'
import type { FairSeed } from '../MissionCompare'

type RankBy = 'margin' | 'count' | 'battery' | 'gap' | 'dark'
const RANK_LABEL: Record<RankBy, string> = { margin: 'Margin above your requirements (recommended)', count: 'Most good landing times', battery: 'Highest lowest-battery', gap: 'Shortest time without Earth', dark: 'Shortest darkness' }
const RANK_NOTE: Record<RankBy, string> = {
  margin: 'Sites whose best landing meets your requirements come first, then the largest margin above your requirements on the tightest check, then the most good landing times. This is headroom against the limits you set, not a landing-safety measure.',
  count: 'Most landing times in your search range that meet every requirement.',
  battery: 'Highest lowest battery charge at each site’s best landing.',
  gap: 'Shortest time without Earth in view at each site’s best landing.',
  dark: 'Shortest continuous darkness at each site’s best landing.',
}
const RelayPanel = lazy(() => import('./RelayPanel').then(m => ({ default: m.RelayPanel })))
import type { Ephemeris, Horizon, Site } from '../data'
import {
  CELL_FAIL,
  CELL_PASS,
  evaluateWindow,
  maxLastStart,
  solve,
  minimalRelaxations,
  type Binding,
  type Constraints,
  type Evaluated,
  type Opportunity,
} from './solver'

type EphPair = Record<'sun' | 'earth', Ephemeris>

type Props = {
  datasetIndex: import('../lib/predictionIndex').PredictionIndex
  totalSiteCount?: number
  sites: Site[]
  eph: Record<string, EphPair>
  horizons: Record<string, Horizon>
  /** UTC ms of the first cached hour. */
  startMs: number
  currentSlug: string
  sceneRow: number
  onPreviewMission:(slug:string,startRow:number,endRow:number)=>void
  onOpenWindow: (slug: string, startRow: number, endRow: number) => void
  onClose: () => void
  /** Open the Compare workspace with these scenarios (the Explore hook). */
  compareSeed?: { key: number; scns: Scn[];note?:string;preserveMission?:boolean } | null
  guideRequest?:{tool:'energy'|'calendar';id:number}|null
  comparisonRequest?:number
  /** Open the fair comparison page: two sites on the same dates, or one site on two dates. */
  onCompareSites?: (seed?: Omit<FairSeed, 'key'>) => void
  /** Make this site and landing the selected mission (from Compare). */
  selectRequest?: { key: number; slug: string; row: number; constraints?: Constraints } | null
  active?: boolean
}

const HOUR = 3_600_000
const STEP_H = 6
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Illustrative starting points only. They are not NASA or provider requirements. */
const PRESETS: { id: string; label: string; c: Constraints }[] = [
  { id: 'relaxed', label: 'Relaxed', c: { missionDays: 10, minLitPct: 40, maxDarkH: 120, minLinkPct: 40, maxGapH: 120 } },
  { id: 'balanced', label: 'Balanced', c: { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72 } },
  { id: 'demanding', label: 'Demanding', c: { missionDays: 14, minLitPct: 75, maxDarkH: 36, minLinkPct: 75, maxGapH: 36 } },
]

const sameConstraints = (a: Constraints, b: Constraints) =>
  a.missionDays === b.missionDays &&
  a.minLitPct === b.minLitPct &&
  a.maxDarkH === b.maxDarkH &&
  a.minLinkPct === b.minLinkPct &&
  a.maxGapH === b.maxGapH

const pad2 = (n: number) => String(n).padStart(2, '0')

function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  display: string
  onChange: (v: number) => void
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12px] text-inkdim">
          {label}
        </label>
        <span className="font-mono text-[12px] text-ink font-tabular">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 block w-full"
      />
    </div>
  )
}

function Group({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-edge pt-3">
      <legend className="flex items-center gap-1.5 pr-2 text-[12px] font-semibold uppercase tracking-[0.2em] text-inkdim">
        {icon}
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

const METRIC_META: Record<Binding, { label: string; tone: string }> = {
  lit: { label: 'Sunlit', tone: 'text-sun' },
  dark: { label: 'Longest dark', tone: 'text-sun' },
  link: { label: 'Earth visible', tone: 'text-earth' },
  gap: { label: 'Longest gap', tone: 'text-earth' },
}

function metricValue(ev: Evaluated, k: Binding): string {
  switch (k) {
    case 'lit':
      return `${ev.litPct.toFixed(0)}%`
    case 'link':
      return `${ev.linkPct.toFixed(0)}%`
    case 'dark':
      return `${ev.longestDarkH} h`
    case 'gap':
      return `${ev.longestGapH} h`
  }
}

function metricLimit(c: Constraints, k: Binding): string {
  switch (k) {
    case 'lit':
      return `≥ ${c.minLitPct}%`
    case 'link':
      return `≥ ${c.minLinkPct}%`
    case 'dark':
      return `≤ ${c.maxDarkH} h`
    case 'gap':
      return `≤ ${c.maxGapH} h`
  }
}

/** The four outcome metrics. `ev === null` renders an idle skeleton with the
 *  same geometry, so the inspector box never changes size. */
function Metrics({ ev, c, highlightBinding }: { ev: Evaluated | null; c: Constraints; highlightBinding?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {(['lit', 'dark', 'link', 'gap'] as const).map((k) => {
        const ok = ev?.ok[k]
        const tight = !!ev && highlightBinding && ev.binding === k
        return (
          <div key={k} className={'rounded-md px-1.5 py-1 ' + (tight ? 'bg-panel2 ring-1 ring-edge2' : '')}>
            <div className={'text-[12px] font-semibold uppercase tracking-[0.16em] ' + (ev ? METRIC_META[k].tone : 'text-inkdim/70')}>
              {METRIC_META[k].label}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={
                  'font-mono text-lg font-tabular ' +
                  (ev === null ? 'text-inkdim/50' : ok ? 'text-ink' : 'text-danger')
                }
              >
                {ev ? metricValue(ev, k) : '—'}
              </span>
              {ev &&
                (ok ? (
                  <Check className="h-3 w-3 text-viable" strokeWidth={2.6} aria-label="meets limit" />
                ) : (
                  <X className="h-3 w-3 text-danger" strokeWidth={2.6} aria-label="misses limit" />
                ))}
            </div>
            <div className="font-mono text-[12px] text-inkdim font-tabular">{metricLimit(c, k)}</div>
          </div>
        )
      })}
      {ev?.power && <div className="col-span-2 mt-1 rounded-md border border-edge px-2 py-1 text-[13px] sm:col-span-4">
        <span className={ev.power.pass ? 'text-viable' : 'text-danger'}>{ev.power.firstUnmetH !== null ? `Energy shortfall at ${ev.power.firstUnmetH.toFixed(1)} h` : ev.power.firstReserveH !== null ? `Reserve crossed at ${ev.power.firstReserveH.toFixed(1)} h` : 'Battery maintains reserve'}</span>
        <span className="text-inkdim"> · minimum {ev.power.minPct.toFixed(1)}% · end {ev.power.endPct.toFixed(1)}%</span>
      </div>}
      {ev?.thermal && <div className="col-span-2 mt-1 rounded-md border border-edge px-2 py-1 text-[13px] sm:col-span-4">
        <span className={ev.thermal.pass ? 'text-viable' : 'text-danger'}>{ev.thermal.firstFreezeH !== null ? `Below survival at ${ev.thermal.firstFreezeH} h` : 'Survives the dark'}</span>
        <span className="text-inkdim"> · min {Math.round(ev.thermal.minTempK - 273.15)} °C · heater {(ev.thermal.heaterEnergyWh / 1000).toFixed(1)} kWh</span>
      </div>}
    </div>
  )
}

/** Plain-language list of every constraint a window misses. */
function shortfalls(ev: Evaluated, c: Constraints): string[] {
  const out: string[] = []
  if (!ev.ok.lit) out.push(`${(c.minLitPct - ev.litPct).toFixed(0)} more points of sunlight`)
  if (!ev.ok.dark) out.push(`${ev.longestDarkH - c.maxDarkH} h more darkness tolerated`)
  if (!ev.ok.link) out.push(`${(c.minLinkPct - ev.linkPct).toFixed(0)} more points of Earth link`)
  if (ev.power && !ev.power.pass) out.push(`battery reserve or energy supply improved (${ev.power.minPct.toFixed(1)}% minimum charge, ${ev.power.unmetWh.toFixed(0)} Wh unmet)` )
  if (!ev.ok.gap) out.push(`${ev.longestGapH - c.maxGapH} h longer comm gap tolerated`)
  return out
}

function StripRow({
  name,
  note,
  strip,
  starts,
  totalHours,
  missionHours,
  firstRow,
  lastRow,
  markerRow,
  nowRow,
  label,
  onHover,
  onPin,
  viewStart = 0,
}: {
  name: string
  note: string
  strip: Uint8Array
  starts: number[]
  /** End of the visible span (rows); the strip shows viewStart … totalHours. */
  totalHours: number
  viewStart?: number
  missionHours: number
  firstRow: number
  lastRow: number
  markerRow: number | null
  nowRow: number | null
  label: string
  onHover: (idx: number | null) => void
  onPin: (idx: number) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  const rects = useMemo(() => {
    const out: { x: number; w: number; state: number }[] = []
    let i = 0
    while (i < strip.length) {
      const st = strip[i]
      if (st === CELL_FAIL) {
        i++
        continue
      }
      let j = i
      while (j < strip.length && strip[j] === st) j++
      out.push({ x: starts[i], w: (j - i) * STEP_H, state: st })
      i = j
    }
    return out
  }, [strip, starts])

  const indexAt = (clientX: number): number | null => {
    const box = boxRef.current
    if (!box || starts.length === 0) return null
    const r = box.getBoundingClientRect()
    const row = viewStart + ((clientX - r.left) / r.width) * (totalHours - viewStart)
    const idx = Math.round((row - starts[0]) / STEP_H)
    return idx < 0 || idx >= starts.length ? null : idx
  }

  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 sm:w-36">
        <div className="truncate text-[13px] text-ink">{name}</div>
        <div className="truncate font-mono text-[12px] text-inkdim">{note}</div>
      </div>
      <div
        ref={boxRef}
        role="img"
        aria-label={label}
        className="min-w-0 flex-1 cursor-crosshair touch-none"
        onPointerMove={(e) => onHover(indexAt(e.clientX))}
        onPointerLeave={() => onHover(null)}
        onClick={(e) => {
          const idx = indexAt(e.clientX)
          if (idx !== null) onPin(idx)
        }}
      >
        <svg viewBox={`${viewStart} 0 ${Math.max(1, totalHours - viewStart)} 10`} preserveAspectRatio="none" className="block h-[20px] w-full">
          <rect x={viewStart} y={0} width={Math.max(1, totalHours - viewStart)} height={10} fill="var(--color-paper3)" />
          <rect x={firstRow} y={0} width={Math.max(0, lastRow - firstRow)} height={10} fill="var(--color-edge2)" />
          {rects.map((r, i) => (
            <rect
              key={i}
              x={r.x}
              y={1}
              width={r.w}
              height={8}
              fill="var(--color-viable)"
              opacity={r.state === CELL_PASS ? 1 : 0.28}
            />
          ))}
          {nowRow !== null && (
            <line
              x1={nowRow}
              x2={nowRow}
              y1={0}
              y2={10}
              stroke="var(--color-ink)"
              strokeOpacity={0.55}
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {markerRow !== null && (
            <>
              <rect
                x={markerRow}
                y={0}
                width={Math.max(0, Math.min(missionHours, totalHours - markerRow))}
                height={10}
                fill="var(--color-ink)"
                opacity={0.14}
              />
              <line
                x1={markerRow}
                x2={markerRow}
                y1={0}
                y2={10}
                stroke="var(--color-ink)"
                strokeWidth={1.4}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      </div>
    </div>
  )
}


/** Download a passing landing window as a calendar event (.ics, UTC). */
function exportIcs(name: string, startRow: number, endRow: number, startMs: number) {
  const fmt = (row: number) =>
    new Date(startMs + row * 3_600_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chader Buri//Mission Window//EN',
    'BEGIN:VEVENT',
    `UID:chader-buri-${startRow}-${endRow}-${name.replace(/\s+/g, '-')}@chader-buri`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${fmt(startRow)}`,
    `DTEND:${fmt(endRow)}`,
    `SUMMARY:Lunar mission window — ${name}`,
    'DESCRIPTION:Viable landing window computed by Chader Buri (terrain-masked Sun and Earth link, LOLA horizon masks, JPL Horizons DE441).',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `chader-buri-${name.toLowerCase().replace(/\s+/g, '-')}-${fmt(startRow)}.ics`
  a.click()
  URL.revokeObjectURL(url)
}

export function MissionArchitect({ sites, eph, horizons, startMs, currentSlug, sceneRow,onPreviewMission,onOpenWindow, onClose, compareSeed,guideRequest,comparisonRequest=0,active=true, datasetIndex,totalSiteCount=sites.length, onCompareSites, selectRequest }: Props) {
  const [restored] = useState(loadScenario)
  const [guided, setGuided] = useState(false)
  const [relayExpanded, setRelayExpanded] = useState(false)
  const [tab,setTab]=useState<'overview'|'calendar'|'energy'|'windows'|'guide'>('overview')
  const [rankBy,setRankBy]=useState<RankBy>('margin')
  // First-visit start card: explain the question, then offer three ways in. Hidden once dismissed.
  const [intro,setIntro]=useState(()=>{try{return localStorage.getItem('chader-buri.dashboard-intro')!=='hidden'}catch{return true}})
  const [settingsAttention,setSettingsAttention]=useState(false)
  const hideIntro=()=>{setIntro(false);try{localStorage.setItem('chader-buri.dashboard-intro','hidden')}catch{/* storage unavailable: hide for this visit */}}
  const [mobileInputsOpen,setMobileInputsOpen]=useState(false)
  const resultRef = useRef<HTMLElement>(null)
  // Progressive disclosure: the full ranking and the lander equipment open on request.
  const [allSites,setAllSites]=useState(false)
  const [equipmentOpen,setEquipmentOpen]=useState(false)
  const [printBrief,setPrintBrief]=useState<MissionBrief|null>(null)
  const [shareStatus, setShareStatus] = useState('Copy scenario link')
  const [c, setC] = useState<Constraints>(restored?.constraints ?? { ...PRESETS[1].c, power: { ...DEFAULT_POWER } })
  const [loDay, setLoDay] = useState(() => restored?.loDay ?? Math.max(0, Math.floor((Date.now() - startMs) / (24 * HOUR))))
  const [hiDay, setHiDay] = useState(() => restored?.hiDay ?? Math.max(0, Math.floor((Date.now() - startMs) / (24 * HOUR))) + 90)
  const [hover, setHover] = useState<{ slug: string; idx: number } | null>(null)
  const [pinned, setPinned] = useState<{ slug: string; row: number } | null>(restored?.selection??null)
  const [compareScns, setCompareScns] = useState<Scn[] | null>(null)
  const [compareVisible, setCompareVisible] = useState(false)
  const [comparisonVersion, setComparisonVersion] = useState(0)
  const [comparisonNotice,setComparisonNotice]=useState('')

  useEffect(() => {
    if(!active)return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (compareVisible) setCompareVisible(false); else onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, compareVisible, active])

  // Per-site hourly lit/link series: classification only, computed once and shared with Compare.
  const series = useMemo(() => sites.map((s) => siteSeries(s.slug, eph[s.slug].sun, eph[s.slug].earth, horizons[s.slug])), [sites, eph, horizons])
  const bySlug = useMemo(() => new Map(series.map((s) => [s.slug, s])), [series])
  const siteName = useMemo(() => new Map(sites.map((s) => [s.slug, s.name])), [sites])
  const totalHours = series[0].hours

  const missionHours = c.missionDays * 24
  const maxDay = Math.max(0, Math.floor(maxLastStart(series, missionHours) / 24))
  const lo = Math.min(loDay, maxDay)
  const hi = Math.max(lo, Math.min(hiDay, maxDay))

  const dayLabel = (d: number) => new Date(startMs + d * 24 * HOUR).toISOString().slice(0, 10)
  const nowRowRaw = (Date.now() - startMs) / HOUR
  const nowRow = nowRowRaw >= 0 && nowRowRaw <= totalHours ? nowRowRaw : null

  const result = useMemo(
    () => solve(series, c, { firstStart: lo * 24, lastStart: hi * 24, stepH: STEP_H }),
    [series, c, lo, hi],
  )

  const order = useMemo(() => result.closest.map((x) => x.slug), [result])
  const passBySite = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of result.opportunities) m.set(o.slug, (m.get(o.slug) ?? 0) + o.startCount)
    return m
  }, [result])
  const sitesWithWindows = new Set(result.opportunities.map((o) => o.slug)).size

  const evalAt = (slug: string, row: number): Evaluated | null => {
    const s = bySlug.get(slug)
    if (!s || row + missionHours > s.hours) return null
    return evaluateWindow(s, row, row + missionHours, c)
  }

  const activeSel = hover
    ? { slug: hover.slug, row: result.starts[hover.idx] }
    : pinned && pinned.row + missionHours <= totalHours
      ? pinned
      : null
  const activeEval = activeSel ? evalAt(activeSel.slug, activeSel.row) : null

  const landing = (row: number) => {
    const d = new Date(startMs + row * HOUR)
    return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:00 UTC`
  }

  // The strips show only the searched landing range plus one mission length, with date ticks to match.
  const view = { start: result.starts[0] ?? 0, end: Math.min(totalHours, (result.starts[result.starts.length - 1] ?? 0) + STEP_H + c.missionDays * 24) }
  const ticks = useMemo(() => {
    const out: { row: number; label: string }[] = []
    const spanDays = Math.max(1, (view.end - view.start) / 24)
    const step = spanDays > 400 ? 90 : spanDays > 160 ? 30 : spanDays > 70 ? 14 : 7
    const first = new Date(startMs + view.start * HOUR), firstDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + 1)
    for (let t = firstDay; (t - startMs) / HOUR < view.end; t += step * 24 * HOUR) {
      const d = new Date(t)
      out.push({ row: (t - startMs) / HOUR, label: `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${spanDays > 300 ? ` ${String(d.getUTCFullYear()).slice(2)}` : ''}` })
    }
    return out
  }, [startMs, view.start, view.end])

  const set = <K extends keyof Constraints>(key: K, value: Constraints[K]) => setC((p) => ({ ...p, [key]: value }))

  const none = result.passCount === 0
  const topOpps = result.opportunities.slice(0, 8)
  const closestFew = result.closest.slice(0, 4)

  // when nothing passes: the smallest single-constraint change that opens a
  // window, per requirement. Only computed when needed (each candidate costs
  // a handful of solve passes).
  const relaxations = useMemo(
    () =>
      none && !c.power
        ? minimalRelaxations(series, c, { firstStart: lo * 24, lastStart: hi * 24, stepH: STEP_H })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, c, lo, hi, none],
  )

  const windowSpan = (o: Opportunity) =>
    o.firstStartRow === o.lastStartRow
      ? landing(o.firstStartRow)
      : `${landing(o.firstStartRow)} → ${landing(o.lastStartRow)}`

  const featured = pinned && bySlug.has(pinned.slug) && pinned.row >= lo * 24 && pinned.row <= hi * 24 && pinned.row + missionHours <= totalHours
    ? pinned
    : result.opportunities[0] ? { slug: result.opportunities[0].slug, row: result.opportunities[0].best.startRow }
    : result.closest[0] ? { slug: result.closest[0].slug, row: result.closest[0].best.startRow } : null

  const featuredEval=useMemo(()=>featured?evalAt(featured.slug,featured.row):null,[featured?.slug,featured?.row,bySlug,c])
  // The decision readouts Chader Buri can explain ("why does battery fail?").
  const fe=featuredEval,src='Calculated from JPL Horizons, LOLA horizon and the stated lander'
  useScreenDigest('plan',fe&&featured?[
   {id:'verdict',label:'Mission verdict',value:`${siteName.get(featured.slug)??featured.slug} · ${fe.pass?'meets':'misses'} requirements · limiting: ${fe.limiting}`,status:fe.pass?'ok':'fail',source:src},
   {id:'landing',label:'Mission landing',value:`${new Date(startMs+featured.row*HOUR).toISOString().slice(0,16).replace('T',' ')} UTC · ${c.missionDays} days`},
   {id:'lit',label:'Sunlit share of mission',value:`${fe.litPct.toFixed(1)} (needs ≥ ${c.minLitPct})`,unit:'%',status:fe.ok.lit?'ok':'fail',source:src},
   {id:'link',label:'Earth-visible share of mission',value:`${fe.linkPct.toFixed(1)} (needs ≥ ${c.minLinkPct})`,unit:'%',status:fe.ok.link?'ok':'fail',source:src},
   {id:'dark',label:'Longest darkness',value:`${fe.longestDarkH.toFixed(0)} (limit ${c.maxDarkH})`,unit:'h',status:fe.ok.dark?'ok':'fail',source:src},
   {id:'gap',label:'Longest Earth outage',value:`${fe.longestGapH.toFixed(0)} (limit ${c.maxGapH})`,unit:'h',status:fe.ok.gap?'ok':'fail',source:src},
   ...(fe.power?[{id:'battery',label:'Minimum battery charge',value:`${fe.power.minPct.toFixed(1)} (reserve ${c.power?.reservePct??0})`,unit:'%',status:fe.power.pass?'ok' as const:'fail' as const,source:src}]:[]),
   ...(fe.thermal?[{id:'thermal',label:'Electronics temperature',value:fe.thermal.pass?'survives the dark':'falls below survival',status:fe.thermal.pass?'ok' as const:'fail' as const,source:src}]:[]),
  ]:null,fe&&featured?`${featured.slug}|${featured.row}|${fe.pass}|${fe.margin.toFixed(4)}|${c.missionDays}`:'none')
  const robustness=useRobustness(datasetIndex,featured?.slug,featured?eph[featured.slug].sun:undefined,featured?eph[featured.slug].earth:undefined,featured?horizons[featured.slug]:undefined,featured?.row??0,c)
  const openPrintableBrief=()=>{
    if(!featured)return
    setPrintBrief(buildMissionBrief(datasetIndex,[{id:0,...featured,c},{id:1,slug:featured.slug,row:featured.row+168,c}],bySlug,sites,eph,horizons,{[featured.slug]:robustness.products}))
  }

  // Persist only an actual user pin, not the auto-recommended window — otherwise
  // the recommendation returns on reload labelled as if the user had selected it.
  useEffect(() => { saveScenario({ v: 1, constraints: c, loDay: lo, hiDay: hi, selection: pinned ?? undefined }) }, [c, lo, hi, pinned?.slug, pinned?.row])

  // Restore a shared comparison link, and open the Compare workspace from the
  // current recommendation seeded with the same mission one week later.
  const restoredComparison=useRef(false)
  useEffect(() => {
    if(restoredComparison.current)return
    const parsed = decodeScenarios(new URLSearchParams(window.location.search).get('compare'), (slug) => bySlug.has(slug))
    if (parsed) { restoredComparison.current=true;setCompareScns(parsed); setCompareVisible(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bySlug])
  // The Explore hook: load the reference plan underneath, then open Compare
  // on top, so closing the comparison lands on the same mission in Plan.
  const loadReference = () => {
    const row = referenceRow(startMs)
    setC(referenceConstraints())
    setLoDay(Math.floor(row / 24)); setHiDay(Math.floor(row / 24) + REFERENCE.constraints.missionDays)
    setHover(null); setPinned({ slug: REFERENCE.slug, row }); setGuided(true)
  }
  useEffect(() => {
    if (!compareSeed) return
    const first=compareSeed.scns[0]
    // A surface equipment experiment opens independently. The visitor may adopt an option explicitly inside Compare.
    if(!compareSeed.preserveMission){
      setC(cloneConstraints(first.c));setLoDay(Math.floor(first.row/24));setHiDay(Math.floor(first.row/24)+14)
      setPinned({slug:first.slug,row:first.row});setHover(null);setGuided(false)
    }
    setCompareScns(compareSeed.scns.map(s=>({...s,c:cloneConstraints(s.c)})));setComparisonNotice(compareSeed.note??'')
    setComparisonVersion(v => v + 1)
    setCompareVisible(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareSeed?.key])
  const cloneConstraints = (x: Constraints): Constraints => ({ ...x, power: x.power ? { ...x.power } : undefined, thermal: x.thermal ? { ...x.thermal } : undefined })
  const openCompare = () => {
    if (compareScns) { setCompareVisible(true); return }
    if (!featured) return
    setComparisonNotice('')
    const row2 = Math.max(0, Math.min(featured.row + 7 * 24, totalHours - missionHours))
    setCompareScns([
      { id: 0, slug: featured.slug, row: featured.row, c: cloneConstraints(c) },
      { id: 1, slug: featured.slug, row: row2, c: cloneConstraints(c) },
    ])
    setComparisonVersion(v => v + 1)
    setCompareVisible(true)
  }
  const compareSelected = () => {
    if(!featured)return
    setComparisonNotice('')
    setCompareScns([{id:0,slug:featured.slug,row:featured.row,c:cloneConstraints(c)},{id:1,slug:featured.slug,row:featured.row+7*24,c:cloneConstraints(c)}]);setComparisonVersion(v=>v+1);setCompareVisible(true)
  }
  useEffect(()=>{if(comparisonRequest)openCompare()},[comparisonRequest])
  // Compare can hand a site and landing back to the plan: widen the search range to include it, then select it.
  useEffect(()=>{
    if(!selectRequest)return
    hideIntro()
    const first=Math.floor(selectRequest.row/24),last=Math.ceil(selectRequest.row/24)
    if(first<lo)setLoDay(first)
    if(last>hi)setHiDay(last)
    if(selectRequest.constraints)setC(cloneConstraints(selectRequest.constraints))
    setHover(null);setPinned({slug:selectRequest.slug,row:selectRequest.row});setCompareVisible(false);setTab('overview')
    setMobileInputsOpen(false)
    const frame = requestAnimationFrame(() => {
      if (resultRef.current?.getClientRects().length) {
        resultRef.current.closest('.mp-main')?.scrollTo({ top: 0, behavior: 'auto' })
        resultRef.current.closest('.mp-grid')?.scrollTo({ top: 0, behavior: 'auto' })
        resultRef.current.focus({ preventScroll: true })
      }
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectRequest?.key])
  const inspectEvidence=()=>setTab('energy')

  useEffect(()=>{
    if(!guideRequest)return
    setCompareVisible(false)
    const calendar=guideRequest.tool==='calendar'
    setTab(calendar?'calendar':'energy')
    const frame=requestAnimationFrame(()=>document.getElementById(calendar?'landing-calendar':'energy-detail')?.scrollIntoView({block:'start'}))
    return ()=>cancelAnimationFrame(frame)
  },[guideRequest])
  const copyScenario = async () => {
    const url = scenarioURL({ v: 1, constraints: c, loDay: lo, hiDay: hi, selection: featured ?? undefined },{datasetId:datasetIndex.datasetId,modelVersion:datasetIndex.model.version})
    try { await navigator.clipboard.writeText(url); setShareStatus('Scenario link copied') }
    catch { setShareStatus('Link ready in address bar'); window.history.replaceState(null, '', url) }
  }

  const dataStart = new Date(startMs).toISOString().slice(0, 10)
  const dataEnd = new Date(startMs + totalHours * HOUR).toISOString().slice(0, 10)

  // How "Best sites" is ordered is a visible choice. The default is the planner's own rule:
  // passing first, then the largest margin on the tightest check, then the most good landing times.
  type Ranked = (typeof result.closest)[number]
  const cnt = (slug: string) => passBySite.get(slug) ?? 0
  const passed = (x: Ranked) => Number(x.best.pass)
  const RANK_ORDER: Record<RankBy, (a: Ranked, b: Ranked) => number> = {
    margin: (a, b) => passed(b) - passed(a) || b.best.margin - a.best.margin || cnt(b.slug) - cnt(a.slug),
    count: (a, b) => cnt(b.slug) - cnt(a.slug) || passed(b) - passed(a) || b.best.margin - a.best.margin,
    battery: (a, b) => (b.best.power?.minPct ?? -1) - (a.best.power?.minPct ?? -1) || passed(b) - passed(a),
    gap: (a, b) => a.best.longestGapH - b.best.longestGapH || passed(b) - passed(a),
    dark: (a, b) => a.best.longestDarkH - b.best.longestDarkH || passed(b) - passed(a),
  }
  const ranked = [...result.closest].sort((a, b) => RANK_ORDER[rankBy](a, b) || a.slug.localeCompare(b.slug))
  const rankDetail = (x: Ranked) => rankBy === 'battery' ? (x.best.power ? `lowest battery ${x.best.power.minPct.toFixed(0)}%` : 'battery not assessed')
    : rankBy === 'gap' ? `longest time without Earth ${x.best.longestGapH} h` : rankBy === 'dark' ? `longest darkness ${x.best.longestDarkH} h`
    : cnt(x.slug) > 0 ? `${cnt(x.slug)} good landing ${cnt(x.slug) === 1 ? 'time' : 'times'}` : 'No good landing time'
  const focusSite = (slug: string) => {
    const x = result.closest.find(o => o.slug === slug)
    if (x) { setHover(null); setPinned({ slug, row: x.best.startRow }) }
  }
  const verdict = featuredEval ? verdictText(featuredEval, c) : null
  const missionPeriod = featured ? `During this ${c.missionDays}-day mission: ${landing(featured.row)} to ${landing(featured.row + missionHours)}` : ''
  // Chader Buri pointing at evidence: open the overview and mark the matching requirement or the verdict.
  const pointer = usePointer()
  const CHECK_FOR: Record<string, string> = { battery: 'battery', reserve: 'battery', dark: 'dark', gap: 'gap', lit: 'lit', link: 'link', thermal: 'thermal' }
  const pointedCheck = pointer ? CHECK_FOR[pointer.target] : undefined
  useEffect(() => {
    if (!pointer || pointer.target === 'metrics') return
    setTab('overview'); setCompareVisible(false)
    if (pointer.target === 'verdict' || pointer.target === 'lit' || pointer.target === 'link' || pointer.target === 'thermal') requestAnimationFrame(() => document.querySelector(pointer.target === 'verdict' ? '.mp-verdict' : `.mp-checks [data-check=${pointer.target}]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }, [pointer?.key])
  // A different mission retires whatever she was pointing at.
  const featuredKey = featured ? `${featured.slug}|${featured.row}|${JSON.stringify(c)}` : ''
  const shownKey = useRef(featuredKey)
  useEffect(() => { if (shownKey.current !== featuredKey) { shownKey.current = featuredKey; clearPointer() } }, [featuredKey])
  // A failing landing gets the nearest landing at the same site that the planner has already checked and passed.
  const alternative = featured && featuredEval && !featuredEval.pass
    ? result.opportunities.filter(o => o.slug === featured.slug).map(o => o.best.startRow).sort((a, b) => Math.abs(a - featured.row) - Math.abs(b - featured.row))[0] ?? null
    : null
  const topPassing = result.opportunities[0] ?? null
  const userPicked = !!featured && pinned?.slug === featured.slug && pinned.row === featured.row
  // The summary every dashboard page shows; kept separate from the 3D scene's clock.
  useEffect(() => {
    publishMission(featured && featuredEval ? {
      slug: featured.slug, siteName: siteName.get(featured.slug) ?? featured.slug, row: featured.row, constraints: c,
      landingUTC: landing(featured.row).replace(' UTC', ''), endUTC: landing(featured.row + missionHours).replace(' UTC', ''), missionDays: c.missionDays,
      equipment: equipmentLine(c), verdict: featuredEval.pass ? 'meets' : 'misses', selectedByUser: userPicked,
      updating: robustness.assessment.footprint.status === 'loading' || robustness.assessment.height.status === 'loading',
    } : null)
  })
  useEffect(() => () => publishMission(null), [])
  const checks = featuredEval ? [
    { id: 'lit', label: 'Sunlight on the lander', value: `${featuredEval.litPct.toFixed(0)}%`, need: `needs at least ${c.minLitPct}%`, ok: featuredEval.ok.lit },
    { id: 'link', label: 'Earth in view for radio', value: `${featuredEval.linkPct.toFixed(0)}%`, need: `needs at least ${c.minLinkPct}%`, ok: featuredEval.ok.link },
    { id: 'dark', label: 'Longest time in darkness', value: `${featuredEval.longestDarkH.toFixed(0)} h`, need: `allowed up to ${c.maxDarkH} h`, ok: featuredEval.ok.dark },
    { id: 'gap', label: 'Longest time without Earth', value: `${featuredEval.longestGapH.toFixed(0)} h`, need: `allowed up to ${c.maxGapH} h`, ok: featuredEval.ok.gap },
    ...(featuredEval.power ? [{ id: 'battery', label: 'Lowest battery charge', value: `${featuredEval.power.minPct.toFixed(0)}%`, need: `must stay above ${c.power?.reservePct ?? 0}% reserve`, ok: featuredEval.power.pass }] : []),
    ...(featuredEval.thermal ? [{ id: 'thermal', label: 'Electronics stay warm', value: featuredEval.thermal.pass ? 'Yes' : 'No', need: 'must survive every night', ok: featuredEval.thermal.pass }] : []),
  ] : []
  // Open Mission settings (a drawer on phones) and bring the first control into view.
  const openSettings = () => { setMobileInputsOpen(true); setSettingsAttention(true); window.setTimeout(() => setSettingsAttention(false), 2400); requestAnimationFrame(() => { const el = document.getElementById('ma-days'); el?.scrollIntoView({ block: 'center' }); el?.focus() }) }
  // Phones: close the settings drawer and show the result it changed.
  const doneSettings = () => { setMobileInputsOpen(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('.mp-verdict, .mp-empty')?.scrollIntoView({ block: 'start' })) }
  // Scope beside the verdict: the nearby-touchdown count (never a probability) and what the verdict leaves out.
  const fp = robustness.assessment.footprint
  const nearby = fp.status === 'ready'
    ? `${fp.data.passing} of ${fp.data.samples.length} sampled touchdown points within 250 m meet the same sunlight, Earth-in-view${c.power ? ' and battery' : ''} checks. This is a count of sampled points, not a chance of success.`
    : fp.status === 'loading' ? 'Checking 19 nearby touchdown points…' : 'Nearby touchdown points could not be checked for this site.'
  // One clear next step, chosen from the result; every other action stays under "More actions".
  const between = `between ${landing(lo * 24).slice(0, -10)} and ${landing(hi * 24).slice(0, -10)}`
  const nextStep = !featured || !featuredEval ? null
    : !featuredEval.pass && alternative !== null ? { id: 'alt', note: `Checked alternative: landing at this site on ${landing(alternative)} meets your selected requirements.`, label: 'Use this date', run: () => { setHover(null); setPinned({ slug: featured.slug, row: alternative }) } }
    : !featuredEval.pass && topPassing && topPassing.slug !== featured.slug ? { id: 'site', note: `No landing at this site meets your requirements ${between}. ${siteName.get(topPassing.slug)} has landings that do.`, label: `Show ${siteName.get(topPassing.slug)}`, run: () => focusSite(topPassing.slug) }
    : !featuredEval.pass ? { id: 'settings', note: `No landing at this site meets your requirements ${between}. Try relaxing a requirement or more battery, then check again.`, label: 'Change mission settings', run: openSettings }
    : { id: 'week', note: 'Check how sensitive this result is to the landing date: the same mission one week later.', label: 'Compare with a week later', run: () => onCompareSites ? onCompareSites({ mode: 'dates', slug: featured.slug, row: featured.row, rowB: featured.row + 7 * 24 }) : compareSelected() }
  // Landing-range date fields: the UTC calendar day of a search day, and back.
  const dayFromDate = (v: string) => { const t = Date.parse(`${v}T00:00:00Z`); return Number.isFinite(t) ? Math.max(0, Math.min(maxDay, Math.ceil((t - startMs) / (24 * HOUR) - 1e-9))) : null }
  const offsetH = -new Date().getTimezoneOffset() / 60
  const deviceZone = `UTC${offsetH >= 0 ? '+' : '−'}${Math.abs(offsetH)}`
  const TABS: [typeof tab, string][] = [['overview', 'Overview'], ['calendar', 'Landing calendar'], ['energy', 'Energy & footprint'], ['windows', 'All windows'], ['guide', 'How it works']]

  return (
    <section
      role="region"
      aria-label="Mission plan"
      data-comparing={compareVisible}
      inert={!!printBrief}
      className="workspace-modal mission-workspace mp"
    >
      <div inert={compareVisible} className="mp-grid">
        {/* ---------- left: mission settings ---------- */}
        <aside className={`mission-inputs mp-settings ${mobileInputsOpen ? 'is-open' : ''}`} data-attention={settingsAttention} aria-label="Mission settings">
          <div className="mp-col-head"><h2>Mission settings</h2><p>Describe your mission. Results update instantly.</p></div>
          <div className="mp-presets" role="group" aria-label="Starting points">
            {PRESETS.map((p) => {
              const active = sameConstraints(c, p.c)
              return <button key={p.id} onClick={() => setC((old) => ({ ...p.c, power: old.power }))} aria-pressed={active}>{p.label}</button>
            })}
          </div>
          <p className="mp-hint">Starting points are illustrative, not requirements from NASA or any provider.</p>
          <div className="mp-groups">
            <Group icon={<Rocket className="h-3 w-3" />} title="Mission">
              <Slider id="ma-days" label="Mission length" value={c.missionDays} min={3} max={30} display={`${c.missionDays} days`} onChange={(v) => set('missionDays', v)} />
            </Group>
            <details className="mp-advanced" open={equipmentOpen} onToggle={(e) => setEquipmentOpen(e.currentTarget.open)}>
              <summary><span>Lander equipment <em>advanced</em></span><small>{equipmentLine(c)}</small></summary>
              <PowerControls value={c.power} onChange={(power) => setC((p) => ({ ...p, power, thermal: power ? p.thermal : undefined }))} />
              <ThermalControls value={c.thermal} powerOn={!!c.power} onChange={(thermal) => set('thermal', thermal)} />
            </details>
            <Group icon={<Sun className="h-3 w-3 text-sun" />} title="Sunlight">
              <Slider id="ma-lit" label="At least this much sunlit" value={c.minLitPct} min={0} max={100} display={`${c.minLitPct}%`} onChange={(v) => set('minLitPct', v)} />
              <Slider id="ma-dark" label="Maximum time in darkness" value={c.maxDarkH} min={0} max={400} step={4} display={`${c.maxDarkH} h`} onChange={(v) => set('maxDarkH', v)} />
            </Group>
            <Group icon={<Radio className="h-3 w-3 text-earth" />} title="Earth in view">
              <Slider id="ma-link" label="Minimum Earth visibility" value={c.minLinkPct} min={0} max={100} display={`${c.minLinkPct}%`} onChange={(v) => set('minLinkPct', v)} />
              <Slider id="ma-gap" label="Maximum time without Earth" value={c.maxGapH} min={0} max={400} step={4} display={`${c.maxGapH} h`} onChange={(v) => set('maxGapH', v)} />
            </Group>
            <Group icon={<CalendarRange className="h-3 w-3" />} title="Landing dates to search">
              <Slider id="ma-lo" label="Earliest landing" value={lo} min={0} max={maxDay} display={dayLabel(lo)} onChange={(v) => { setLoDay(v); if (v > hi) setHiDay(v) }} />
              <label className="mp-date"><span>Earliest landing date (UTC)</span><input type="date" min={dayLabel(0)} max={dayLabel(maxDay)} value={dayLabel(lo)} onChange={(e) => { const d = dayFromDate(e.currentTarget.value); if (d !== null) { setLoDay(d); if (d > hi) setHiDay(d) } }} /></label>
              <Slider id="ma-hi" label="Latest landing" value={hi} min={0} max={maxDay} display={dayLabel(hi)} onChange={(v) => { setHiDay(v); if (v < lo) setLoDay(v) }} />
              <label className="mp-date"><span>Latest landing date (UTC)</span><input type="date" min={dayLabel(0)} max={dayLabel(maxDay)} value={dayLabel(hi)} onChange={(e) => { const d = dayFromDate(e.currentTarget.value); if (d !== null) { setHiDay(d); if (d < lo) setLoDay(d) } }} /></label>
              <p className="mp-utc">All dates and times are UTC, the one clock used worldwide for space missions. Your device is on {deviceZone}.</p>
              <button className="mp-link" onClick={() => { setLoDay(Math.max(0, Math.min(maxDay, Math.floor(nowRowRaw / 24)))); setHiDay(9999) }}>Start from today</button>
            </Group>
          </div>
          <button className="dash-btn is-primary mp-settings-done" onClick={doneSettings}>Done — view results</button>
        </aside>

        {/* ---------- centre: the decision ---------- */}
        <main className="mission-results mp-main">
          {intro && <section className="mp-start" aria-label="Start here">
            <div>
              <p className="mp-kicker">Start here</p>
              <h2>Where and when should a lander touch down?</h2>
              <p>At the Moon’s south pole, hills can block sunlight and hide Earth. Choose where and when to land, then see whether your equipment can keep operating.</p>
            </div>
            <div className="mp-start-actions">
              <button className="is-primary" onClick={() => { loadReference(); setTab('overview'); hideIntro() }}><strong>Try an example mission</strong><small>{REFERENCE.name}, from 17 Oct 2026, 14 days · every setting stays editable</small></button>
              <button onClick={() => { hideIntro(); onCompareSites?.({ mode: 'sites' }) }}><strong>Compare two sites</strong><small>Same date and lander, side by side</small></button>
              <button onClick={() => { hideIntro(); openSettings() }}><strong>Build my mission</strong><small>Set your own dates and equipment on the left</small></button>
            </div>
            <button className="mp-link mp-start-hide" onClick={hideIntro}>Hide this</button>
          </section>}
          <MissionViewControls view={TABS.find(([id]) => id === tab)?.[1] ?? 'Overview'} resetKey={selectRequest?.key}>
          <div className="mp-toolbar">
            <label className="mp-field"><span>Site</span><select aria-label="Site to plan" value={featured?.slug ?? ''} onChange={(e) => focusSite(e.target.value)}>{ranked.map((x) => <option key={x.slug} value={x.slug}>{siteName.get(x.slug)}</option>)}</select></label>
            <div className="mp-field"><span>Landing (UTC)</span><strong>{featured ? landing(featured.row) : '—'}<button className="mp-link" onClick={() => setTab('calendar')}>Change date</button></strong></div>
            <div className="mp-toolbar-actions">
              <button className="dash-btn mp-settings-toggle" aria-expanded={mobileInputsOpen} onClick={() => setMobileInputsOpen(open => !open)}>{mobileInputsOpen ? 'Hide settings' : 'Mission settings'}</button>
              <button className="dash-btn" onClick={openCompare} title="Give each option its own equipment or requirements">Compare equipment</button>
              <button className="dash-btn scenario-share-desktop" onClick={copyScenario}>{shareStatus}</button>
            </div>
          </div>
          <p className="mp-ready">{sites.length} of {totalSiteCount} sites ready · data {dataStart} to {dataEnd}</p>
          <nav className="mp-tabs" aria-label="Mission plan views">{TABS.map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
          </MissionViewControls>

          {tab === 'overview' && <div className="mp-stack">
            {!featured && <section ref={resultRef} tabIndex={-1} className="mp-card mp-empty" role="status">
              <h4 className="mp-card-title">{sites.length === 0 ? 'Loading site data…' : 'No landing can be checked with these dates'}</h4>
              <p className="mp-muted">{sites.length === 0 ? 'The site predictions are still loading. The mission appears here as soon as the first site is ready.' : `A ${c.missionDays}-day mission has to fit inside the cached data (${dataStart} to ${dataEnd}). Choose an earlier landing range or a shorter mission in Mission settings.`}</p>
              {sites.length > 0 && <button className="dash-btn" onClick={() => { setLoDay(Math.max(0, Math.min(maxDay, Math.floor(nowRowRaw / 24)))); setHiDay(9999) }}>Search from today</button>}
            </section>}
            {featured && featuredEval && <section ref={resultRef} tabIndex={-1} className="mp-card mp-verdict" data-ok={featuredEval.pass} data-pointed={pointer?.target === 'verdict' || undefined} aria-label="Selected mission decision">
              <div className="mp-verdict-head">
                <div><p className="mp-kicker">{userPicked ? 'Your selected landing' : featuredEval.pass ? 'Recommended for these settings' : 'Closest to working for these settings'}</p><h3>{siteName.get(featured.slug)}</h3><p className="mp-sub">Lands {landing(featured.row)} · ends {landing(featured.row + missionHours)} · {c.missionDays}-day mission</p></div>
                <span className="mp-verdict-side"><span className="mp-badge" data-ok={featuredEval.pass}>{featuredEval.pass ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}{verdict?.headline}<EvidenceButton id="verdict" period={missionPeriod} /></span><BuriWhy label={featuredEval.pass ? 'Why does it pass?' : 'Why does it miss?'} onClick={() => askAbout('verdict')} /></span>
              </div>
              {verdict && <dl className="mp-why">
                <div><dt>Main reason</dt><dd>{verdict.why}</dd></div>
                <div><dt>{verdict.marginLabel}</dt><dd>{verdict.margin}</dd></div>
                <div><dt>Checked</dt><dd>{verdict.assessed.join(', ')}, against the limits you set (not NASA requirements).</dd></div>
              </dl>}
              {verdict && <div className="mp-scope" aria-label="What this result covers">
                <p><strong>Basis</strong><span>Nominal landing coordinate · hourly samples · LRO LOLA terrain (measured) and JPL Horizons positions (predicted) · illustrative lander hardware · uncertainty bound not established.</span></p>
                <p><strong>Nearby touchdowns</strong><span>{nearby}</span></p>
                <p><strong>Not checked</strong><span>{verdict.notAssessed.join(' · ')}. Meeting your requirements is not a landing-safety or mission-success assessment.</span></p>
              </div>}
              {nextStep && <div className="mp-next" data-ok={featuredEval.pass}>
                <p><span className="mp-next-label">Next step</span>{nextStep.note}</p>
                <button className="dash-btn is-primary" onClick={nextStep.run}>{nextStep.label} <ArrowRight className="h-4 w-4" /></button>
              </div>}
              <p className="mp-period">During this {c.missionDays}-day mission</p>
              <div className="mp-stats">
                <div><span>Lowest battery</span><strong>{featuredEval.power ? `${featuredEval.power.minPct.toFixed(0)}%` : '—'}</strong></div>
                <div><span>Sunlight</span><strong>{featuredEval.litPct.toFixed(0)}%</strong></div>
                <div><span>Earth in view</span><strong>{featuredEval.linkPct.toFixed(0)}%</strong></div>
                <div><span>Longest darkness</span><strong>{featuredEval.longestDarkH.toFixed(0)} h</strong></div>
              </div>
              <details className="mp-more">
                <summary>More actions</summary>
                <div className="mp-actions">
                  <button className="dash-btn" onClick={() => onOpenWindow(featured.slug, featured.row, featured.row + missionHours)}>Visit this site in 3D</button>
                  {nextStep?.id !== 'week' && <button className="dash-btn" onClick={() => onCompareSites ? onCompareSites({ mode: 'dates', slug: featured.slug, row: featured.row, rowB: featured.row + 7 * 24 }) : compareSelected()}>Compare with a week later</button>}
                  {onCompareSites && <button className="dash-btn" onClick={() => onCompareSites({ mode: 'sites', slug: featured.slug, row: featured.row })}>Compare with another site</button>}
                  <button className="dash-btn" onClick={inspectEvidence}>See energy details</button>
                  <button className="dash-btn" disabled={robustness.assessment.footprint.status === 'loading' || robustness.assessment.height.status === 'loading'} onClick={openPrintableBrief}>Printable brief</button>
                </div>
              </details>
              <MissionCsvDownloads index={datasetIndex} scenarios={[{id:0,...featured,c,label:'Selected mission'}]} series={bySlug} sites={sites} eph={eph} horizons={horizons}/>
            </section>}

            {checks.length > 0 && <section className="mp-card" aria-label="Requirement checks">
              <h4 className="mp-card-title">Requirement checks <span className="mp-title-note">during this {c.missionDays}-day mission</span></h4>
              <ul className="mp-checks">{checks.map(k => <li key={k.id} data-ok={k.ok} data-check={k.id} data-pointed={pointedCheck === k.id || undefined}><span className="mp-check-icon" role="img" aria-label={k.ok ? 'Passes' : 'Fails'}>{k.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</span><span className="mp-check-label">{k.label}<small>{k.need}</small></span><strong>{k.value}<span className="sr-only">{k.ok ? ', passes' : ', fails'}</span></strong><EvidenceButton id={k.id as EvidenceId} label={k.label} period={missionPeriod} /></li>)}</ul>
            </section>}
            {featured && featuredEval && <CoverageMatrix c={c} ev={featuredEval} robustness={robustness.assessment} period={missionPeriod} />}

            {featured && featuredEval && <MissionQuestions series={bySlug.get(featured.slug)!} row={featured.row} c={c} ev={featuredEval} sunRows={eph[featured.slug].sun.rows} earthRows={eph[featured.slug].earth.rows} horizon={horizons[featured.slug]} robustness={robustness.assessment} fmt={landing} onPick={(row) => { setHover(null); setPinned({ slug: featured.slug, row }) }} onDetails={inspectEvidence} />}

            <section className="mp-card" aria-live="polite" aria-label="Landing windows">
              <h4 className="mp-card-title">{none ? 'No landing works with these settings' : `${result.opportunities.length} good landing ${result.opportunities.length === 1 ? 'window' : 'windows'} at ${sitesWithWindows} of ${sites.length} sites`}</h4>
              <p className="mp-muted">{none ? `Checked ${result.starts.length} landing times at ${sites.length} sites. See what you would need to change.` : `${result.passCount} of ${result.starts.length * sites.length} landing times pass, checked every ${STEP_H} hours.`}</p>
              <ol className="mp-mini-list">{(none ? closestFew.map(x => ({ key: x.slug, slug: x.slug, when: landing(x.best.startRow), start: x.best.startRow, end: x.best.endRow })) : topOpps.slice(0, 3).map(o => ({ key: `${o.slug}-${o.firstStartRow}`, slug: o.slug, when: windowSpan(o), start: o.best.startRow, end: o.best.endRow }))).map((w, i) => <li key={w.key}><span className="mp-rank-n">{i + 1}</span><span>{siteName.get(w.slug)}<small>{none ? 'closest: ' : ''}{w.when}</small></span><button className="dash-btn" onClick={() => { setHover(null); setPinned({ slug: w.slug, row: w.start }) }}>Select</button></li>)}</ol>
              <button className="mp-link" onClick={() => setTab('windows')}>{none ? 'What would make it work →' : 'See all windows →'}</button>
            </section>

            {featured && <p className="mp-muted mp-scene-note">The 3D scene shows {siteName.get(currentSlug)} at {new Date(startMs + sceneRow * HOUR).toISOString().slice(0, 16).replace('T', ' ')} UTC, separate from this plan. <button className="mp-link" onClick={() => onPreviewMission(featured.slug, featured.row, featured.row + missionHours)}>Show this landing date in the scene</button></p>}
          </div>}

          {tab === 'calendar' && <div className="mp-stack">
            {featured && <section className="mp-card" id="landing-calendar">
              <h4 className="mp-card-title">Landing calendar · {siteName.get(featured.slug)}</h4>
              <p className="mp-muted">Pick a day to land. Green days meet every requirement.</p>
              <FeasibilityCalendar startMs={startMs} series={bySlug.get(featured.slug)!} c={c} loDay={lo} hiDay={hi} missionHours={missionHours} siteName={siteName.get(featured.slug) ?? featured.slug} onPick={(row) => { setHover(null); setPinned({ slug: featured.slug, row }) }} />
            </section>}
            <section className="mp-card">
              <h4 className="mp-card-title">Every site, every landing date</h4>
              <div className="mp-strip-inspector">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13px] text-ink">
                    {activeSel ? <><span className="font-medium">{siteName.get(activeSel.slug)}</span><span className="text-inkdim"> · lands </span><span className="font-tabular">{landing(activeSel.row)}</span><span className="text-inkdim"> · ends </span><span className="font-tabular">{landing(activeSel.row + missionHours)}</span></> : <span className="text-inkdim">Point at or tap a row to inspect a landing date · click to select it</span>}
                  </div>
                  <span className={'mp-badge ' + (activeEval ? '' : 'invisible')} data-ok={activeEval?.pass} title="Minimum normalized slack across enabled constraints; not a probability">{activeEval ? `${activeEval.pass ? 'passes' : 'fails'} · score ${activeEval.margin.toFixed(3)}` : '—'}</span>
                </div>
                <div className="mt-2"><Metrics ev={activeEval} c={c} highlightBinding /></div>
              </div>
              <div className="mp-legend"><span>Landing date →</span><span><i className="bg-viable" /> passing</span><span><i className="bg-viable/30" /> near miss</span><span><i className="bg-paper3" /> fails</span></div>
              <div className="space-y-1.5">
                {order.map((slug) => {
                  const n = passBySite.get(slug) ?? 0
                  const name = siteName.get(slug) ?? slug
                  return <StripRow key={slug} name={name} note={n > 0 ? `${n} passing landings` : 'no passing landing'} label={`${name}: ${n} passing landing times of ${result.starts.length}`} strip={result.strips[slug]} starts={result.starts} totalHours={view.end} viewStart={view.start} missionHours={missionHours} firstRow={result.starts[0] ?? 0} lastRow={(result.starts[result.starts.length - 1] ?? 0) + STEP_H} markerRow={activeSel ? activeSel.row : null} nowRow={nowRow} onHover={(idx) => setHover(idx === null ? null : { slug, idx })} onPin={(idx) => setPinned({ slug, row: result.starts[idx] })} />
                })}
              </div>
              <div className="relative ml-[7.75rem] mt-1 h-4 sm:ml-[9.75rem]">
                {ticks.map((t, ti) => {
                  const f = (t.row - view.start) / Math.max(1, view.end - view.start)
                  const shift = f < 0.02 ? '' : f > 0.98 ? '-translate-x-full' : '-translate-x-1/2'
                  return <span key={t.row} className={`absolute whitespace-nowrap text-[12px] text-inkdim ${shift} ${ti % 2 === 1 ? 'hidden sm:block' : ''}`} style={{ left: `${f * 100}%` }}>{t.label}</span>
                })}
                {nowRow !== null && nowRow >= view.start && nowRow <= view.end && <span className="absolute -translate-x-1/2 text-[12px] font-semibold text-ink/70" style={{ left: `${((nowRow - view.start) / Math.max(1, view.end - view.start)) * 100}%`, top: '1.1rem' }}>now</span>}
              </div>
            </section>
          </div>}

          {tab === 'energy' && <div className="mp-stack" id="energy-detail">
            {!featured && <p className="mp-muted">Choose a site to see its energy details.</p>}
            {featured && <EnergyPanel series={bySlug.get(featured.slug)!} name={siteName.get(featured.slug) ?? featured.slug} row={featured.row} constraints={c} startMs={startMs} recommended={featured !== pinned} earthRows={eph[featured.slug].earth.rows} datasetIndex={datasetIndex} robustness={robustness.assessment} evidence={{ sun: eph[featured.slug].sun.provenance, earth: eph[featured.slug].earth.provenance, terrain: horizons[featured.slug] }} onApplyPower={(power) => { setPinned(featured); setC(p => ({ ...p, power })) }} onShare={copyScenario} shareStatus={shareStatus} onOpen={() => onOpenWindow(featured.slug, featured.row, featured.row + missionHours)} />}
            {featured && <HeightSensitivityPanel slug={featured.slug} horizon={horizons[featured.slug]} assessment={robustness.assessment} />}
            {featured && <div id="landing-footprint"><DispersionPanel slug={featured.slug} sun={eph[featured.slug].sun} earth={eph[featured.slug].earth} row={featured.row} constraints={c} datasetIndex={datasetIndex} assessment={robustness.assessment} products={robustness.products} /></div>}
            {featured && <details className="mp-card" onToggle={(e) => setRelayExpanded(e.currentTarget.open)}><summary className="mp-card-title">Could a relay satellite improve Earth contact?</summary>{relayExpanded && <Suspense fallback={<p className="p-4 text-xs text-inkdim">Loading relay design…</p>}><RelayPanel horizon={horizons[featured.slug]} earth={eph[featured.slug].earth} row={featured.row} hours={missionHours} /></Suspense>}</details>}
            {pinned && <button className="mp-link" onClick={() => setPinned(null)}>Return to the best landing found</button>}
          </div>}

          {tab === 'windows' && <div className="mp-stack">
            {none ? <>
              <section className="mp-card">
                <h4 className="mp-card-title">What would make it work</h4>
                <p className="mp-muted">{c.power ? 'No option meets the selected hardware and visibility limits. Inspect the energy shortfall, then change panel size, battery, demand or the landing requirements.' : 'Each suggestion relaxes one requirement and keeps the others. A relaxed requirement is a design trade, not proof of mission safety.'}</p>
                <ol className="mp-list">{relaxations.map((r) => <li key={r.binding}>
                  <div className="mp-list-head"><span>{siteName.get(r.slug)} · {r.binding === 'lit' ? 'sunlight floor' : r.binding === 'link' ? 'Earth-link floor' : r.binding === 'dark' ? 'darkness ceiling' : 'Earth-gap ceiling'}: <span className="text-danger">{r.requested}{r.unit}</span> → <span className="text-viable">{r.relaxedTo}{r.unit}</span></span><button className="dash-btn" onClick={() => onOpenWindow(r.slug, r.window.startRow, r.window.endRow)}>Visit window</button></div>
                  <Metrics ev={r.window} c={c} />
                </li>)}</ol>
              </section>
              <section className="mp-card">
                <h4 className="mp-card-title">Closest to working</h4>
                <ol className="mp-list">{closestFew.map((x, i) => {
                  const parts = shortfalls(x.best, c)
                  return <li key={x.slug}>
                    <div className="mp-list-head"><span><b className="mp-rank-n">{i + 1}</b>{siteName.get(x.slug)} · best landing {landing(x.best.startRow)}</span><span className="flex gap-2"><button className="dash-btn" onClick={() => { setPinned({ slug: x.slug, row: x.best.startRow }); inspectEvidence() }}>Energy details</button><button className="dash-btn" onClick={() => onOpenWindow(x.slug, x.best.startRow, x.best.endRow)}>Visit</button></span></div>
                    <p className="mp-muted">{explain(x.best, c)}</p>
                    <Metrics ev={x.best} c={c} />
                    {parts.length > 0 && <p className="mp-muted">Measured shortfalls: {parts.join(' · ')}.</p>}
                  </li>
                })}</ol>
              </section>
            </> : <section className="mp-card">
              <h4 className="mp-card-title">Good landing windows · best margin first</h4>
              <p className="mp-muted">Ties go to the window with more passing landing times.{result.opportunities.length > topOpps.length ? ` Showing ${topOpps.length} of ${result.opportunities.length}.` : ''}</p>
              <ol className="mp-list">{topOpps.map((o, i) => <li key={`${o.slug}-${o.firstStartRow}`}>
                <div className="mp-list-head"><span><b className="mp-rank-n">{i + 1}</b>{siteName.get(o.slug)}<span className="mp-score" title="Minimum normalized slack across enabled constraints; not a probability">score {o.best.margin.toFixed(3)}</span></span>
                  <span className="flex gap-2"><button className="dash-btn" onClick={() => { setPinned({ slug: o.slug, row: o.best.startRow }); setTab('overview') }}>Select</button><button className="dash-btn" onClick={() => exportIcs(siteName.get(o.slug) ?? o.slug, o.best.startRow, o.best.endRow, startMs)} title="Add this window to your calendar (.ics)">.ics</button><button className="dash-btn" onClick={() => onOpenWindow(o.slug, o.best.startRow, o.best.endRow)}>Visit</button></span></div>
                <p className="mp-muted">Land {windowSpan(o)} · {o.startCount} passing landing times · best {landing(o.best.startRow)}</p>
                <p className="mp-muted">{explain(o.best, c)}</p>
                <Metrics ev={o.best} c={c} highlightBinding />
              </li>)}</ol>
            </section>}
          </div>}

          {tab === 'guide' && <div className="mp-stack">
            <section className="mp-card mission-guide" aria-label="Mission decision walkthrough">
              <p className="mp-kicker">One decision · traceable evidence</p>
              <h4 className="mp-card-title">Does a passing landing survive a nearby touchdown?</h4>
              <p className="mp-muted">Load Malapert on 17 October 2026 for 14 days. First inspect energy, then check the 19-point <Term id="footprint">footprint</Term>. All results are recalculated from the current data.</p>
              <button className="dash-btn is-primary" onClick={() => { loadReference(); setTab('overview') }}>Load the worked example</button>
              {!intro && <button className="dash-btn" onClick={() => { setIntro(true); try { localStorage.removeItem('chader-buri.dashboard-intro') } catch { /* storage unavailable */ } }}>Show the start card again</button>}
              {guided && <p className="mission-guide-note">{REFERENCE.hardwareNote} Changing controls recalculates the scenario.</p>}
              <Explain>Plan answers one question: for a site, a landing date and a lander, does the mission get enough sunlight, keep sight of Earth, and keep its battery above the <Term id="reserve">reserve</Term>? The <Term id="limiting">limiting constraint</Term> is the one to fix first.</Explain>
            </section>
            <section className="mp-card">
              <h4 className="mp-card-title">How to read this</h4>
              <p className="mp-muted">Data window {dataStart} – {dataEnd}: hourly Sun and Earth positions from NASA/JPL Horizons (DE441), masked by LRO LOLA terrain horizons at 1° azimuth. Visibility uses centre clearance; grazing indicates partial solar-disc exposure. Power uses the visible disc fraction and an approximate eclipse mask, 1361 W/m² at 1 AU, and editable panel and battery assumptions. Hourly left-endpoint integration cannot resolve subhour outages. Earth visibility is geometric, not a communications guarantee. Ranking maximizes the smallest normalized slack (percentage points ÷ 100, hours ÷ mission hours, battery reserve points ÷ 100; unmet energy is penalized relative to capacity). Ties prefer more passing samples, then earlier landings. The final ephemeris sample is an end boundary. Thresholds are yours, not NASA requirements.</p>
              <p className="mp-muted">Thermal {c.thermal ? 'included' : 'not assessed'} · RF diagnostic only · footprint assessed separately. Results are screening estimates.</p>
            </section>
          </div>}
        </main>

        {/* ---------- right: ranking ---------- */}
        <aside className="mp-rank" aria-label="Best sites for this mission">
          <div className="mp-col-head"><h2>Best sites</h2><p>For your settings · landings {landing(lo * 24).slice(0, -10)} to {landing(hi * 24).slice(0, -10)}</p></div>
          {allSites && <><label className="mp-rank-by"><span>Rank by</span><select value={rankBy} onChange={(e) => setRankBy(e.target.value as RankBy)}>{(Object.keys(RANK_LABEL) as RankBy[]).map(k => <option key={k} value={k}>{RANK_LABEL[k]}</option>)}</select></label>
          <p className="mp-rank-note">{RANK_NOTE[rankBy]}</p></>}
          <ol id="mp-rank-list">{(allSites ? ranked : ranked.slice(0, 3)).map((x, i) => {
            const n = cnt(x.slug)
            return <li key={x.slug}><button aria-current={featured?.slug === x.slug ? 'true' : undefined} onClick={() => focusSite(x.slug)}>
              <span className="mp-rank-n">{i + 1}</span>
              <span className="mp-rank-name">{siteName.get(x.slug)}{i === 0 && rankBy === 'margin' && x.best.pass && <em className="mp-rank-rec">Recommended</em>}<small>{rankDetail(x)}</small></span>
              <span className="mp-rank-dot" data-ok={n > 0} role="img" title={n > 0 ? 'Has landings that meet your requirements' : 'No landing meets your requirements'} aria-label={n > 0 ? 'Has landings that meet your requirements' : 'No landing meets your requirements'}>{n > 0 ? '✓' : '✕'}</span>
            </button></li>
          })}</ol>
          {ranked.length > 3 && <button className="mp-link mp-rank-more" aria-expanded={allSites} aria-controls="mp-rank-list" onClick={() => setAllSites(v => !v)}>{allSites ? 'Show the top 3 only' : `Show all ${ranked.length} sites and the ranking rule`}</button>}
        </aside>
      </div>
      <div hidden={!compareVisible}>{compareScns && <ScenarioCompare key={comparisonVersion} eph={eph} horizons={horizons} introNote={comparisonNotice} datasetIndex={datasetIndex} sites={sites} bySlug={bySlug} startMs={startMs} seed={compareScns} onClose={() => setCompareVisible(false)} onPreviewMission={onPreviewMission} onUseScenario={s => {
        setC({...s.c,power:s.c.power?{...s.c.power}:undefined,thermal:s.c.thermal?{...s.c.thermal}:undefined})
        setLoDay(Math.floor(s.row/24))
        setHiDay(Math.min(Math.floor((bySlug.get(s.slug)!.hours-s.c.missionDays*24)/24),Math.floor(s.row/24)+14))
        setPinned({slug:s.slug,row:s.row});setHover(null);setCompareVisible(false);setTab('energy')
      }} />}</div>
      {printBrief&&<PrintableBrief brief={printBrief} onClose={()=>setPrintBrief(null)}/>}
    </section>
  )
}
