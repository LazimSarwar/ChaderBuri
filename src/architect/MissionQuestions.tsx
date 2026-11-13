import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from './solver.ts'
import type { EphRow, Horizon } from '../data'
import { SkyChart } from '../SkyChart'
import { RobustnessSummary } from './RobustnessSummary'
import type { RobustnessAssessment } from './robustness'
import { MissionGlance } from './MissionGlance'
import { BuriWhy, MomentTable, TimeSteps } from './MomentTable'
import { askAbout, usePointer } from '../lib/guideDesk'
import { DayTable } from './Evidence'
import { dayOf, keyMoments, missionTimeline, momentAt, momentText, skylineSentence } from '../lib/missionMoment'

/**
 * The overview, organised around the questions a visitor asks about one landing:
 * can the lander keep running, how long is the dark, when is Earth in view, why is
 * something blocked, would another day help, how much hangs on my assumptions, and
 * would a nearby touchdown change it. Every number comes from the same calculations
 * the verdict uses; nothing here is described as passing unless it was evaluated.
 */
type Props = {
  series: SiteSeries; row: number; c: Constraints; ev: Evaluated
  sunRows: EphRow[]; earthRows: EphRow[]; horizon: Horizon
  robustness: RobustnessAssessment
  fmt: (row: number) => string
  onPick: (row: number) => void
  onDetails: () => void
}
/** The first failing check of a landing, in a few words. */
function whyMiss(ev: Evaluated) {
  return ev.power && !ev.power.pass ? `battery falls to ${ev.power.minPct.toFixed(0)}%` : !ev.ok.dark ? `${ev.longestDarkH} h of darkness` : !ev.ok.gap ? `${ev.longestGapH} h without Earth` : !ev.ok.lit ? `only ${ev.litPct.toFixed(0)}% sunlight` : !ev.ok.link ? `Earth in view only ${ev.linkPct.toFixed(0)}%` : ev.thermal && !ev.thermal.pass ? 'electronics get too cold' : 'all checks pass'
}
/** Energy in Wh or kWh, whichever reads better. */
const energy =(wh: number) => wh >= 1000 ? `${(wh / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kWh` : `${wh.toFixed(0)} Wh`
const hoursText = (h: number) => h >= 48 ? `${h} h (about ${(h / 24).toFixed(1)} days)` : `${h} h`

export function MissionQuestions(p: Props) {
  const { series, row, c, ev } = p
  const tl = useMemo(() => missionTimeline(series, row, c), [series, row, c])
  const { end, run, dark, gap, lowest, reserveRow } = tl
  const inDark = (r: number | null) => r !== null && !!dark && r >= dark[0] && r <= dark[1]
  // One time cursor (mission hour) shared by the timeline, the readout table and the skyline.
  const [hour, setHour] = useState(0)
  useEffect(() => setHour(0), [series.slug, row])
  const m = momentAt(tl, p.sunRows, p.earthRows, p.horizon, hour)
  // When Chader Buri points at the timeline, move the cursor there and outline the interval.
  const pointer = usePointer(), card = useRef<HTMLElement>(null)
  const onTimeline = !!pointer && ['dark', 'gap', 'reserve', 'battery', 'moment'].includes(pointer.target)
  useEffect(() => {
    if (!pointer || !onTimeline) return
    const t = pointer.target
    setHour(pointer.hour ?? (t === 'dark' && dark ? dark[0] - row : t === 'gap' && gap ? gap[0] - row : t === 'reserve' && reserveRow !== null ? Math.floor(reserveRow - row) + 1 : lowest ? lowest.row - row : 0))
    requestAnimationFrame(() => card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [pointer?.key])
  const band = pointer?.target === 'dark' ? dark : pointer?.target === 'gap' ? gap : null

  const answers = [
    {
      q: 'Can the lander keep running?',
      ok: !c.power ? null : ev.power?.pass ?? null,
      ask: () => askAbout('battery'),
      a: !c.power || !ev.power ? 'Not assessed: the battery check is turned off in Mission settings.'
        : ev.power.pass ? `Yes. The battery stays above your ${c.power.reservePct}% reserve. Its lowest point is ${ev.power.minPct.toFixed(0)}%${lowest ? ` on day ${dayOf(lowest.row - row, c.missionDays)}` : ''}.`
        : `No. The battery drops below your ${c.power.reservePct}% reserve on day ${dayOf((reserveRow ?? row) - row, c.missionDays)}${inDark(reserveRow) ? ', during the longest darkness' : ''}, and falls to ${ev.power.minPct.toFixed(0)}%.${ev.power.unmetWh > 1e-8 ? ` ${energy(ev.power.unmetWh)} of demand goes unmet.` : ''}`,
    },
    {
      q: 'How long will darkness last?',
      ok: ev.ok.dark,
      ask: () => askAbout('dark'),
      a: dark ? `The Sun is up ${ev.litPct.toFixed(0)}% of the mission, but the longest continuous darkness is ${hoursText(dark[1] - dark[0])}, from ${p.fmt(dark[0])} to ${p.fmt(dark[1])}. That is what the battery has to bridge.` : 'The Sun stays above the skyline for the whole mission.',
    },
    {
      q: 'When can Earth be seen?',
      ok: ev.ok.gap && ev.ok.link,
      ask: () => askAbout('earth'),
      a: gap ? `Earth is in view ${ev.linkPct.toFixed(0)}% of the mission. The longest time without Earth is ${hoursText(gap[1] - gap[0])}, from ${p.fmt(gap[0])} to ${p.fmt(gap[1])}.` : 'Earth stays above the skyline for the whole mission.',
    },
  ]

  return <>
    <section ref={card} className="mp-card" aria-label="Through the mission">
      <h4 className="mp-card-title">Through the mission <span className="mp-title-note">{p.fmt(row)} to {p.fmt(end)}</span></h4>
      <MissionGlance series={series} row={row} c={c} run={run} marks={{ lowest, reserveRow, dark, gap }} highlight={band} cursor={{ hour: m.hour, onChange: setHour, label: 'Time cursor: moment of the mission to inspect', text: momentText(m, p.fmt) }} />
      <TimeSteps moments={keyMoments(tl).map(k => ({ ...k, label: k.label }))} hour={m.hour} span={tl.span} onHour={setHour} />
      <div className="mp-moment">
        <div className="mp-moment-main">
          <MomentTable cols={[{ label: 'This mission', when: p.fmt(m.row), m }]} caption={`The mission at ${p.fmt(m.row)}`} />
          <BuriWhy label="Explain this moment" onClick={() => askAbout('moment', m.hour)} />
        </div>
        <div className="mp-moment-sky">
          <h5>Why is the Sun or Earth blocked?</h5>
          <SkyChart horizon={p.horizon} sunAz={m.sun.az} sunEl={m.sun.el} earthAz={m.earth.az} earthEl={m.earth.el} />
          <p>{skylineSentence('The Sun', m.sun)}</p><p>{skylineSentence('Earth', m.earth)}</p>
          <p className="mp-muted">The shaded shape is the measured skyline (LRO LOLA terrain) all around the landing point. Anything below it is hidden by hills.</p>
        </div>
      </div>
      <dl className="mp-answers">{answers.map(a => <div key={a.q} data-ok={a.ok === null ? undefined : a.ok}>
        <dt><span className="mp-answer-icon" aria-hidden="true">{a.ok === null ? '–' : a.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</span>{a.q}</dt>
        <dd>{a.a}{a.ok !== null && <BuriWhy label="Why?" onClick={a.ask} />}</dd>
      </div>)}</dl>
      <DayTable tl={tl} series={series} days={c.missionDays} />
    </section>
    <NearbyDates {...p} />
    <Assumptions {...p} end={end} />
    <NearbyTouchdown robustness={p.robustness} ev={ev} onDetails={p.onDetails} />
  </>
}

/** Would landing on a different day change the outcome? Same site, lander and duration. */
function NearbyDates(p: Props) {
  const offsets = [-7, -3, -1, 0, 1, 3, 7]
  const days = offsets.map(o => {
    const r = p.row + o * 24
    const ev = r >= 0 && r + p.c.missionDays * 24 <= p.series.hours ? evaluateWindow(p.series, r, r + p.c.missionDays * 24, p.c) : null
    return { o, r, ev }
  })
  const changes = days.filter(d => d.o !== 0 && d.ev && d.ev.pass !== p.ev.pass)
  const why = whyMiss
  return <section className="mp-card" aria-label="Nearby landing dates">
    <h4 className="mp-card-title">Would a different day change it? <span className="mp-title-note">same site, lander and {p.c.missionDays}-day mission</span></h4>
    <div className="mp-days">{days.map(d => <button key={d.o} disabled={!d.ev || d.o === 0} aria-current={d.o === 0 ? 'true' : undefined} data-ok={d.ev ? d.ev.pass : undefined} onClick={() => d.ev && p.onPick(d.r)}>
      <span>{d.o === 0 ? 'Your date' : `${d.o > 0 ? '+' : '−'}${Math.abs(d.o)} day${Math.abs(d.o) > 1 ? 's' : ''}`}</span>
      <strong>{d.ev ? (d.ev.pass ? '✓ Meets' : '✕ Misses') : 'No data'}</strong>
      <small>{d.ev ? (d.ev.pass ? (d.ev.power ? `lowest ${d.ev.power.minPct.toFixed(0)}%` : `${d.ev.litPct.toFixed(0)}% sun`) : why(d.ev)) : 'outside cache'}</small>
    </button>)}</div>
    <p className="mp-muted">{changes.length === 0 ? `Every nearby date that has data gives the same answer as your date${p.ev.pass ? ': it meets your requirements' : ': it misses your requirements'}.` : changes.map(d => `${d.o > 0 ? '+' : '−'}${Math.abs(d.o)} day${Math.abs(d.o) > 1 ? 's' : ''}: ${d.ev!.pass ? 'meets your requirements' : `misses (${why(d.ev!)})`}`).join(' · ') + '. Choose a day to make it your landing.'}</p>
  </section>
}

/** How much does the answer depend on my assumptions? One setting changed at a time. */
function Assumptions(p: Props & { end: number }) {
  const power = p.c.power
  const variants = !power ? [] : [
    { label: 'Demand +20%', c: { ...p.c, power: { ...power, loadW: Math.round(power.loadW * 1.2) } }, days: p.c.missionDays },
    { label: 'Battery −25%', c: { ...p.c, power: { ...power, capacityWh: Math.round(power.capacityWh * .75) } }, days: p.c.missionDays },
    { label: 'Panel −25%', c: { ...p.c, power: { ...power, panelAreaM2: Number((power.panelAreaM2 * .75).toFixed(2)) } }, days: p.c.missionDays },
    { label: 'Reserve +10 points', c: { ...p.c, power: { ...power, reservePct: Math.min(100, power.reservePct + 10) } }, days: p.c.missionDays },
    { label: 'Mission +3 days', c: { ...p.c, missionDays: p.c.missionDays + 3 }, days: p.c.missionDays + 3 },
  ]
  const results = variants.map(v => ({ ...v, ev: p.row + v.days * 24 <= p.series.hours ? evaluateWindow(p.series, p.row, p.row + v.days * 24, v.c) : null }))
  return <section className="mp-card" aria-label="Assumption checks">
    <h4 className="mp-card-title">How much depends on my assumptions? <span className="mp-title-note">one setting changed at a time, same site and landing</span></h4>
    {!power ? <p className="mp-muted">Turn on “Require battery reserve” in Mission settings to test the equipment assumptions.</p> : <div className="mp-days">{results.map(v => <div key={v.label} data-ok={v.ev ? v.ev.pass : undefined}>
      <span>{v.label}</span>
      <strong>{v.ev ? (v.ev.pass ? '✓ Meets' : '✕ Misses') : 'No data'}</strong>
      <small>{v.ev ? (v.ev.pass ? (v.ev.power ? `lowest ${v.ev.power.minPct.toFixed(0)}%` : '') : whyMiss(v.ev)) : 'outside cache'}</small>
    </div>)}</div>}
    {power && <p className="mp-muted">Your current answer: {p.ev.pass ? 'meets' : 'misses'} your requirements. Where a change flips the answer, that assumption matters most.</p>}
  </section>
}

/** Would a nearby touchdown change it? 19 sampled points within 250 m, each with its own terrain horizon. */
function NearbyTouchdown({ robustness, ev, onDetails }: { robustness: RobustnessAssessment; ev: Evaluated; onDetails: () => void }) {
  const fp = robustness.footprint
  return <section className="mp-card" aria-label="Touchdown variation">
    <h4 className="mp-card-title">Would a nearby touchdown change it? <span className="mp-title-note">19 points within 250 m</span></h4>
    <div className="mp-touchdown">
      {fp.status === 'ready' ? <svg viewBox="0 0 150 150" className="mp-footprint" role="img" aria-label={`${fp.data.passing} of 19 nearby touchdown points meet your requirements. North is up.`}>
        <circle cx="75" cy="75" r="62" className="mp-fp-ring" /><circle cx="75" cy="75" r="31" className="mp-fp-ring is-inner" />
        <text x="75" y="9" textAnchor="middle" className="mp-glance-axis">N</text>
        {fp.data.samples.map((s, i) => { const x = 75 + s.terrain.eastM * .248, y = 75 - s.terrain.northM * .248, r = i === 0 ? 7 : 5.5
          // Shape as well as colour: a filled dot meets, a cross misses.
          return <g key={i}><title>{`Point ${i + 1}${i === 0 ? ' (target)' : ''}: ${s.result.pass ? 'meets' : 'misses'} your requirements`}</title>{s.result.pass ? <circle cx={x} cy={y} r={r} className="mp-fp-pass" /> : <><circle cx={x} cy={y} r={r} className="mp-fp-fail" /><path d={`M${x - r * .5},${y - r * .5}L${x + r * .5},${y + r * .5}M${x + r * .5},${y - r * .5}L${x - r * .5},${y + r * .5}`} className="mp-fp-cross" /></>}</g> })}
      </svg> : <div className="mp-footprint is-empty">{fp.status === 'loading' ? 'Checking nearby points…' : 'Not assessed: terrain samples unavailable.'}</div>}
      <div>
        <RobustnessSummary assessment={robustness} nominal={ev} onInspect={onDetails} />
        <p className="mp-muted">Green dots meet the same visibility and battery requirements as the target; red crosses miss. Thermal survival and radio are not assessed at these points. This is a sensitivity check, not a landing-safety assessment.</p>
      </div>
    </div>
  </section>
}
