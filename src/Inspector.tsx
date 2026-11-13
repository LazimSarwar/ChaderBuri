import { referencePanelPower } from './lib/science.ts'
import { useState } from 'react'
import { Flag, Mountain, Radio, Rocket, Sun, Zap } from 'lucide-react'
import { missionLanded, type Duty, type EphRow, type Horizon, type Mission, type Site } from './data'
import { eclipseFactor, sunVerdict, solarDiscFraction } from './data'
import { nextHorizonCrossing, type NextCrossing } from './lib/attribution'
import { SkyChart } from './SkyChart'
import { PowerTimeline } from './PowerTimeline'
import { FieldProbe } from './FieldProbe'
import { DSN_MASK_DEG, dsnPasses } from './lib/dsn'
import { Term } from './Explain'
import type { ReactNode } from 'react'
import { useScreenDigest } from './lib/screenDigest'
import { parseRowT } from './lib/sim'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const dayUTC = (d: Date) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`
const timeUTC = (d: Date) => `${dayUTC(d)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        'rounded px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] ' +
        (ok ? 'bg-viable/15 text-viable' : 'bg-danger/15 text-danger')
      }
    >
      {label}
    </span>
  )
}

function Stat({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-inkdim">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] text-ink font-tabular">{children}</div>
    </div>
  )
}

type InspectorProps = {
  epoch: Date
  site: Site
  horizon: Horizon
  duty: Duty
  sun: EphRow
  earth: EphRow
  sunRowsAll: EphRow[]
  earthRowsAll: EphRow[]
  mission: Mission | null
  focusMission: Mission | null
  /** smooth-Moon mode: verdicts above ignore terrain; these are the real-LOLA verdicts */
  smoothMoon?: boolean
  terrainDelta?: { lit: boolean; dte: boolean }
  /** stand on the surface at this site (surface-visit mode) */
  onDiscover?: () => void
  /** Which moment the cards describe: the 3D scene's clock (default) or your mission's landing time. */
  timeBasis?: 'scene' | 'mission'
}

function MissionCard({ m }: { m: Mission }) {
  const flown = missionLanded(m)
  return (
    <div className="rounded-xl border border-sunhot/40 bg-sunhot/[0.05] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-display text-[14px] font-semibold text-ink">
          <Rocket className="h-3.5 w-3.5 text-sunhot" />
          {m.name}
        </span>
        <span
          className={
            'rounded px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] ' +
            (flown ? 'bg-viable/15 text-viable' : 'bg-sun/10 text-sun/90')
          }
        >
          {m.status}
        </span>
      </div>
      <div className="mt-1 text-[12px] text-inkdim">{m.provider}</div>
      {!flown && (m.target || m.launchWindow) && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
          <span className="text-ink/85">{m.target ?? 'Target TBA'}</span>
          {m.launchWindow && (
            <span className="shrink-0 rounded bg-sun/10 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.1em] text-sun/90">
              {m.launchWindow}
            </span>
          )}
        </div>
      )}
      {m.landingUTC && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="touchdown">
            {m.landingUTC.slice(0, 10)}
            <span className="text-[12px] text-inkdim"> {m.landingUTC.slice(11, 16)} UT</span>
          </Stat>
          {m.sunAtTouchdown && (
            <Stat label="sun at touchdown">
              <span className="text-viable">+{m.sunAtTouchdown.el.toFixed(1)}°</span>
            </Stat>
          )}
        </div>
      )}
      {m.lat !== null && m.lonEast !== null && (
        <div className="mt-1.5 font-mono text-[12px] text-inkdim">
          {Math.abs(m.lat).toFixed(3)}°{m.lat < 0 ? 'S' : 'N'}{' '}
          {Math.abs(m.lonEast).toFixed(3)}°{m.lonEast < 0 ? 'W' : 'E'}
        </div>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-inkdim">{m.note}</p>
      {m.payloads && m.payloads.length > 0 && (
        <details className="mt-2 rounded-lg border border-edge bg-transparent p-2">
          <summary className="cursor-pointer text-[12px] text-ink">
            Payload manifest · {m.payloads.length} delivered payloads
          </summary>
          <ul className="mt-2 space-y-2">
            {m.payloads.map((p) => (
              <li key={p.name} className="border-b border-dashed border-edge pb-2 last:border-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-medium text-ink">{p.name}</span>
                  <span className="rounded bg-sun/10 px-1 py-0.5 text-[10px] uppercase tracking-[0.08em] text-sun/90">{p.kind}</span>
                  <span className={'rounded px-1 py-0.5 text-[10px] uppercase tracking-[0.08em] ' + (p.agency === 'NASA' ? 'bg-earth/10 text-earth' : 'border border-edge text-inkdim')}>
                    {p.agency}
                  </span>
                  {p.unconfirmed && <span className="text-[10px] uppercase tracking-wide text-inkdim" title="Single-sourced detail">unconfirmed</span>}
                </div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-inkdim">{p.purpose}</div>
                {p.sourceUrl && <a className="text-[12px] text-earth underline" href={p.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-1.5 text-[12px] uppercase tracking-[0.12em] text-inkdim/70">
        Reviewed {m.lastReviewed ?? 'date not recorded'} · {m.sources}
      </p>
      <div className="mt-2 flex flex-wrap gap-3">{m.sourceUrls?.map((url, i) => <a key={url} className="text-[12px] text-earth underline" href={url} target="_blank" rel="noreferrer">Mission source {i + 1}</a>)}</div>
    </div>
  )
}

export function Inspector({
  epoch,
  site,
  horizon,
  duty,
  sun,
  earth,
  sunRowsAll,
  earthRowsAll,
  mission,
  focusMission,
  smoothMoon,
  terrainDelta,
  onDiscover,
  timeBasis = 'scene',
}: InspectorProps) {
  const [tab, setTab] = useState<'overview' | 'science'>('overview')

  const sunHz = horizon.profile[Math.round(sun.az) % 360]
  const earthHz = horizon.profile[Math.round(earth.az) % 360]
  const verdict = sunVerdict(sun.el, sunHz, sun.radiusDeg)
  const lit = sun.el > sunHz
  const grazing = verdict === 'grazing'
  const dte = earth.el > earthHz
  const eclipse = eclipseFactor(sun.az, sun.el, earth.az, earth.el, sun.radiusDeg, earth.radiusDeg)
  const watts = referencePanelPower(sun, earth, sunHz)
  const dsn = dsnPasses(epoch)
  const dsnUp = dsn.filter((d) => d.ok)
  const best = dsnUp.sort((a, b) => b.elevDeg - a.elevDeg)[0]
  const latH = `${Math.abs(site.lat).toFixed(3)}°${site.lat < 0 ? 'S' : 'N'}`
  const lonH = `${Math.abs(site.lonEast).toFixed(3)}°${site.lonEast < 0 ? 'W' : 'E'}`
  // time remaining before sunset / Earthset (statement language) — or the next rise when already down
  const sunSet = nextHorizonCrossing(sunRowsAll, epoch, horizon, false)
  const sunRise = nextHorizonCrossing(sunRowsAll, epoch, horizon, true)
  const earthSet = nextHorizonCrossing(earthRowsAll, epoch, horizon, false)
  const earthRise = nextHorizonCrossing(earthRowsAll, epoch, horizon, true)
  const fmtEta = (c: NextCrossing | null) =>
    c === null ? 'none in window' : c.hours >= 48 ? `in ${(c.hours / 24).toFixed(1)} d` : `in ${Math.round(c.hours)} h`
  const sunEta = lit || grazing
    ? sunSet && sunSet.hours > 0
      ? `sunset ${fmtEta(sunSet)}`
      : 'no sunset in window'
    : sunRise
      ? `below ridge · sunrise ${fmtEta(sunRise)}`
      : 'below ridge — no rise in window'
  const earthEta = dte
    ? earthSet && earthSet.hours > 0 ? `Earthset ${fmtEta(earthSet)}` : 'no Earthset in window'
    : earthRise
      ? `below ridge · Earthrise ${fmtEta(earthRise)}`
      : 'below ridge — no rise in window'
  // Tell Chader Buri what this screen shows, so "why is this red?" resolves to a real readout.
  const geometry = 'JPL Horizons + LOLA terrain horizon'
  useScreenDigest('conditions', [
    { id: 'sun', label: 'Sun at the target', value: `${verdict} · elevation ${sun.el.toFixed(1)}° · clearance ${(sun.el - sunHz).toFixed(1)}°`, status: verdict === 'lit' ? 'ok' : verdict === 'grazing' ? 'warn' : 'fail', source: geometry },
    { id: 'sun-eta', label: 'Sunset / sunrise', value: sunEta, source: geometry },
    { id: 'earth', label: 'Earth at the target', value: `${dte ? 'visible' : 'masked'} · clearance ${(earth.el - earthHz).toFixed(1)}°`, status: dte ? 'ok' : 'fail', source: geometry },
    { id: 'earth-eta', label: 'Earthset / Earthrise', value: earthEta, source: geometry },
    { id: 'panel', label: 'Horizontal reference panel output', value: watts.toFixed(0), unit: 'W/m²', status: watts > 0 ? 'ok' : 'warn', source: 'Horizontal 28% panel, calculated' },
    ...(eclipse < 1 ? [{ id: 'eclipse', label: 'Earth eclipsing the Sun', value: `${((1 - eclipse) * 100).toFixed(0)}% of disc`, status: 'warn' as const, source: geometry }] : []),
    { id: 'dsn', label: 'Best DSN station geometry', value: best ? `${best.name} ${best.elevDeg.toFixed(0)}° elevation` : 'none above mask', status: best ? 'ok' : 'warn', source: 'Analytic station geometry; not a scheduled pass' },
  ], `${site.slug}|${Math.round(epoch.getTime() / 3.6e6)}|${verdict}|${dte}|${best?.name ?? ''}`)

  return (
    <div className="space-y-3">
      {focusMission && <MissionCard m={focusMission} />}
      {focusMission && focusMission.siteSlug !== site.slug && <p className="rounded-lg border border-edge bg-panel2/60 p-3 text-[12px] leading-relaxed text-inkdim">
        This mission location has no precomputed terrain profile. The analysis below is for <strong className="text-ink">{site.name}</strong> at the selected simulation time, not the mission's landing location or touchdown time.
      </p>}

      {/* site header — WHERE am I */}
      <div className="cond-head">
        <p className="mp-kicker">Site conditions · {timeBasis === 'mission' ? 'at your mission’s landing' : 'at 3D scene time'} {timeUTC(epoch)} UTC</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="cond-title">{site.name}</h1>
          <span className="rounded border border-edge2 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-inkdim">
            {site.kind === 'clps' ? 'CLPS · flown' : 'Candidate'}
          </span>
          {mission && focusMission !== mission && (
            <span className="flex items-center gap-1 rounded border border-viable/40 bg-viable/10 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-viable">
              <Flag className="h-2.5 w-2.5" strokeWidth={2.4} />
              {mission.name}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[12px] text-inkdim">
          <span>
            {latH} {lonH}
          </span>
          <span className="flex items-center gap-1">
            <Mountain className="h-3 w-3" />
            {site.siteHeightM !== undefined
              ? `${site.siteHeightM >= 0 ? '+' : ''}${(site.siteHeightM / 1000).toFixed(2)} km`
              : '—'}
          </span>
        </div>
        {onDiscover && (
          <button onClick={onDiscover} className="dash-btn is-primary cond-visit">
            <Mountain className="h-4 w-4" /> Visit this site · 360°
          </button>
        )}
      </div>

      {/* duty-cycle stats — CAN I OPERATE */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-edge bg-panel2/60 p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-inkdim">
            <Sun className="h-3 w-3 text-sun" /> Sunlight · all cached data
          </div>
          <div className="mt-1 font-mono text-xl font-medium text-ink font-tabular">
            {duty.litPct.toFixed(1)}
            <span className="text-xs text-inkdim">%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper3">
            <div className="h-full rounded-full bg-sun" style={{ width: `${duty.litPct}%` }} />
          </div>
          <div className="mt-1.5 text-[12px] text-inkdim">
            longest dark <span className="font-mono text-ink">{Math.round(duty.longestDarkH)} h</span>
          </div>
          <div className="text-[12px] text-inkdim">
            {sunEta.startsWith('sunset') ? (
              <>
                sunset <span className="font-mono text-sun">{sunEta.replace('sunset ', '')}</span>
              </>
            ) : (
              sunEta
            )}
          </div>
        </div>
        <div className="rounded-xl border border-edge bg-panel2/60 p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-inkdim">
            <Radio className="h-3 w-3 text-earth" /> Earth in view · all cached data
          </div>
          <div className="mt-1 font-mono text-xl font-medium text-ink font-tabular">
            {duty.linkPct.toFixed(1)}
            <span className="text-xs text-inkdim">%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper3">
            <div className="h-full rounded-full bg-earth" style={{ width: `${duty.linkPct}%` }} />
          </div>
          <div className="mt-1.5 text-[12px] text-inkdim">
            longest gap <span className="font-mono text-ink">{Math.round(duty.longestNoLinkH)} h</span>
          </div>
          <div className="text-[12px] text-inkdim">
            {earthEta.startsWith('Earthset') ? (
              <>
                Earthset <span className="font-mono text-earth">{earthEta.replace('Earthset ', '')}</span>
              </>
            ) : (
              earthEta
            )}
          </div>
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-inkdim"><strong className="text-ink">Time periods:</strong> the two percentages and longest gaps cover all cached data ({dayUTC(parseRowT(sunRowsAll[0].t))} to {dayUTC(parseRowT(sunRowsAll[sunRowsAll.length - 1].t))} UTC); sunrise, sunset and the cards below are from {timeBasis === 'mission' ? 'your mission’s landing time' : 'the 3D scene time'}. Duty cycles count Sun/Earth centre clearance above terrain; they exclude eclipses. Sunset/Earthset countdowns interpolate the hourly series against the terrain mask. Grazing describes partial solar-disc exposure. Earth visibility is not a radio link budget or a DSN booking.</p>
      {/* progressive disclosure: overview first, science on demand */}
      <div className="dash-seg" role="group" aria-label="Conditions view">
        {(
          [
            ['overview', 'Conditions'],
            ['science', 'Science'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-2">
          <div className="rounded-xl border border-edge border-l-2 border-l-sun bg-panel2/60 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-inkdim">
                <Sun className="h-3.5 w-3.5 text-sun" /> Sun
              </span>
              {grazing ? (
                <span className="rounded bg-sun/15 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-sun">
                  grazing
                </span>
              ) : (
                <Pill ok={lit} label={lit ? 'lit' : 'shadowed'} />
              )}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label={<Term id="azimuth">azimuth</Term>}>{sun.az.toFixed(1)}°</Stat>
              <Stat label={<Term id="elevation">elevation</Term>}>{sun.el.toFixed(2)}°</Stat>
              <Stat label="Horizontal reference panel">
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3 text-sun" />
                  {Math.round(watts)}
                  <span className="text-[12px] text-inkdim">W/m²</span>
                </span>
                <span className="mt-0.5 block font-sans text-[12px] font-normal leading-snug text-inkdim">Flat panel facing up, for comparing sites; your mission’s lander may track the Sun.</span>
              </Stat>
            </div>
            {smoothMoon && (
              <p className="mt-1 text-[12px] leading-snug">
                {terrainDelta && terrainDelta.lit !== lit && (
                  <span className="text-sun">
                    Real LOLA terrain says the Sun here is{' '}
                    {terrainDelta.lit ? 'centre-visible' : 'centre-masked'} — terrain is the whole story.
                  </span>
                )}
                {terrainDelta && terrainDelta.lit === lit && (
                  <span className="text-inkdim">Real LOLA terrain agrees on the Sun here.</span>
                )}
              </p>
            )}
            <p className="mt-2 text-[12px] leading-snug text-inkdim">
              Sun centre {lit ? 'clears' : 'is below'} the ridge by {Math.abs(sun.el - sunHz).toFixed(2)}°.
              {' '}{Math.round(solarDiscFraction(sun.el, sunHz, sun.radiusDeg) * 100)}% of the solar disc is above terrain.
              {eclipse < 0.999 && <> Earth occultation covers {Math.round((1 - eclipse) * 100)}% of the solar disc.</>}
            </p>
          </div>

          <div className="rounded-xl border border-edge border-l-2 border-l-earth bg-panel2/60 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-inkdim">
                <Radio className="h-3.5 w-3.5 text-earth" /> <Term id="dte">Earth link</Term>
              </span>
              <Pill ok={dte} label={dte ? 'centre visible' : 'centre masked'} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label={<Term id="azimuth">azimuth</Term>}>{earth.az.toFixed(1)}°</Stat>
              <Stat label={<Term id="elevation">elevation</Term>}>{earth.el.toFixed(2)}°</Stat>
              <Stat label={<Term id="horizon-mask">clearance</Term>}>
                {(earth.el - earthHz >= 0 ? '+' : '') + (earth.el - earthHz).toFixed(1)}°
              </Stat>
            </div>
            <p className="mt-2 text-[12px] leading-snug text-inkdim">
              {dte
                ? 'Earth centre clears terrain. Station-specific lunar visibility, antenna pointing, and link budget still need checking.'
                : 'Earth centre is terrain-masked; this does not resolve individual ground stations on the Earth disc.'}
            </p>
            <p className="mt-1 border-t border-edge/60 pt-1 text-[12px] leading-snug text-inkdim">
              {dsnUp.length > 0 ? (
                <>
                  DSN sky geometry: <span className="text-viable">{dsnUp.length}/3 complexes in view</span>
                  {best && (
                    <> — best {best.name} at +{best.elevDeg.toFixed(1)}° (mask {DSN_MASK_DEG}°)</>
                  )}
                </>
              ) : (
                <>
                  DSN sky geometry: <span className="text-danger">no complex sees the Moon</span> right now —
                  even with line of sight, wait for a pass
                </>
              )}
            </p>
          </div>

          <p className="text-[12px] leading-relaxed text-inkdim">{site.note}</p>

          <FieldProbe site={site} horizon={horizon} />
        </div>
      )}

      {tab === 'science' && (
        <div className="grid gap-3">
          <div className="rounded-xl border border-edge bg-panel2/60 p-3">
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-inkdim">
              power &amp; comms — full window
            </div>
            <PowerTimeline sunRows={sunRowsAll} earthRows={earthRowsAll} horizon={horizon} />
          </div>

          <div className="rounded-xl border border-edge bg-panel2/60 p-3">
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-inkdim">
              sky view — terrain horizon
            </div>
            <SkyChart
              horizon={horizon}
              sunAz={sun.az}
              sunEl={sun.el}
              earthAz={earth.az}
              earthEl={earth.el}
            />
          </div>

          <div className="rounded-xl border border-edge bg-panel2/60 p-3 text-[12px] leading-relaxed text-inkdim">
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.18em]">provenance</div>
            <p>
              Sun/Earth geometry: NASA/JPL Horizons, DE441, body-fixed site frame.
              Terrain: {horizon.demSource} ({horizon.dem}), 360-azimuth <Term id="horizon-mask">horizon mask</Term> marched
              to 160 km. Power model: 28%-efficient horizontal panel, 1,361 W/m² solar
              constant — example assumptions, not lander-specific.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
