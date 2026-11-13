import { useState } from 'react'
import { ChevronLeft, Flag, Globe2, Grid3X3, MapPin, Navigation, Rocket, Sun } from 'lucide-react'
import type { Duty, Mission, PayloadKind, Site } from './data'

export type Layers = {
  labels: boolean
  craters: boolean
  graticule: boolean
  sunPath: boolean
  /** comparison mode: verdicts computed against a smooth sphere (no LOLA terrain) */
  smoothMoon: boolean
}

type Tab = 'sites' | 'missions'

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-paper3">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

type SitesPanelProps = {
  sites: Site[]
  duty: Record<string, Duty>
  siteSlug: string
  onSite: (slug: string) => void
  flownSlugs: Map<string, string>
  missions: Mission[]
  missionIdx: number | null
  onMission: (idx: number | null) => void
  layers: Layers
  onLayers: (l: Layers) => void
  search: string
  onSearch: (value:string)=>void
  tab: Tab
  onTab: (value:Tab)=>void
  collapsed: boolean
  onToggleCollapse: () => void
}

/** Chips for every payload kind present in the catalog. Null = all missions. */
function PayloadFilter({ missions, selected, onSelect }: {
  missions: Mission[]
  selected: PayloadKind | null
  onSelect: (k: PayloadKind | null) => void
}) {
  const kinds = [...new Set(missions.flatMap((m) => (m.payloads ?? []).map((p) => p.kind)))].sort()
  if (kinds.length === 0) return null
  const matches = (k: PayloadKind | null) =>
    missions.filter((m) => (k === null ? true : (m.payloads ?? []).some((p) => p.kind === k))).length
  return (
    <div className="mb-2 px-1">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-inkdim">
        Payload type · {matches(selected)} of {missions.length} missions
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => onSelect(null)}
          className={
            'rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-150 ' +
            (selected === null ? 'border-sun/60 bg-sun/10 text-sun' : 'border-edge text-inkdim hover:text-ink')
          }
        >
          all
        </button>
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => onSelect(selected === k ? null : k)}
            className={
              'rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-150 ' +
              (selected === k ? 'border-sun/60 bg-sun/10 text-sun' : 'border-edge text-inkdim hover:text-ink')
            }
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SitesPanel({
  sites,
  duty,
  siteSlug,
  onSite,
  flownSlugs,
  missions,
  missionIdx,
  onMission,
  layers,
  onLayers,
  search,onSearch,tab,onTab,
  collapsed,
  onToggleCollapse,
}: SitesPanelProps) {
  const needle=search.trim().toLowerCase()
  const matchingSites=sites.filter(site=>site.name.toLowerCase().includes(needle)||site.slug.includes(needle))
  const matchesMission=(m:Mission)=>[m.name,m.provider,m.target,m.vehicle,...(m.payloads??[]).map(p=>p.name)].some(v=>v?.toLowerCase().includes(needle))
  const [kindFilter, setKindFilter] = useState<PayloadKind | null>(null)

  if (collapsed) {
    return (
      <aside className="pointer-events-auto hidden w-[52px] shrink-0 flex-col items-center gap-2 rounded-xl border border-edge bg-panel/70 py-3 backdrop-blur-md lg:flex">
        <button
          onClick={onToggleCollapse}
          className="rounded-md border border-edge p-1 text-inkdim transition-colors duration-150 hover:text-ink"
          title="Expand panel"
        >
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </button>
        {sites.map((s) => {
          const active = s.slug === siteSlug
          return (
            <button
              key={s.slug}
              onClick={() => onSite(s.slug)}
              title={s.name}
              className={
                'flex h-8 w-8 items-center justify-center rounded-md border font-display text-[12px] font-bold transition-colors duration-150 ' +
                (active
                  ? 'border-sun/50 bg-sun/10 text-sun'
                  : 'border-edge text-inkdim hover:text-ink')
              }
            >
              {s.name.slice(0, 1)}
            </button>
          )
        })}
      </aside>
    )
  }

  return (
    <aside className="pointer-events-auto flex h-full w-72 max-w-full shrink-0 flex-col overflow-hidden rounded-xl border border-edge bg-panel/95 backdrop-blur-md lg:flex">
      <div className="sites-toolbar">
        <div className="dash-seg" role="group" aria-label="Show sites or missions">
        {(
          [
            ['sites', `Sites · ${sites.length}`],
            ['missions', `Missions · ${missions.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {onTab(key);onSearch('')}}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
        </div>
        <label className="sites-search"><span className="sr-only">Search {tab}</span><input type="search" maxLength={100} value={search} placeholder={`Search ${tab}…`} onChange={e=>onSearch(e.target.value)} /></label>
        <button
          onClick={onToggleCollapse}
          className="px-2 text-inkdim transition-colors duration-150 hover:text-ink"
          title="Collapse panel"
          data-panel-close
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      {tab === 'sites' && (
        <>
          <div className="sites-grid flex-1 overflow-y-auto p-2">
            {!matchingSites.length&&<p className="p-2">No matching sites.</p>}
            {matchingSites.map((s) => {
              const active = s.slug === siteSlug
              const d = duty[s.slug]
              const flown = flownSlugs.get(s.slug)
              return (
                <button key={s.slug} onClick={() => onSite(s.slug)} className="site-card" aria-current={active ? 'true' : undefined}>
                  <span className="site-card-head">
                    <strong>{s.name}</strong>
                    {flown ? <span className="site-card-tag" data-flown="true"><Flag className="h-3 w-3" strokeWidth={2.2} />Mission</span> : <span className="site-card-tag">{active ? 'Selected' : 'Candidate'}</span>}
                  </span>
                  <span className="site-card-row"><Sun className="h-3.5 w-3.5 shrink-0 text-sun" /><span>Sunlight</span><Bar pct={d?.litPct ?? 0} color="var(--color-sun)" /><b>{d ? `${d.litPct.toFixed(0)}%` : '—'}</b></span>
                  <span className="site-card-row"><Navigation className="h-3.5 w-3.5 shrink-0 text-earth" /><span>Earth in view</span><Bar pct={d?.linkPct ?? 0} color="var(--color-earth)" /><b>{d ? `${d.linkPct.toFixed(0)}%` : '—'}</b></span>
                  <span className="site-card-foot">See conditions →</span>
                </button>
              )
            })}
          </div>

          <details className="max-h-[50%] shrink-0 overflow-auto border-t border-edge p-3">
            <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.16em] text-inkdim">Map layers</summary>
            <div className="mt-2 space-y-1.5">
              {(
                [
                  ['labels', 'Site labels', MapPin],
                  ['craters', 'Crater names', MapPin],
                  ['graticule', 'Coordinate grid', Grid3X3],
                  ['sunPath', 'Sun path (24 h)', Sun],
                  ['smoothMoon', 'Smooth Moon — ignore terrain', Globe2],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => onLayers({ ...layers, [key]: !layers[key] })}
                  className={
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors duration-150 ' +
                    (layers[key]
                      ? 'bg-earth/10 text-earth'
                      : 'text-inkdim hover:bg-panel2 hover:text-ink')
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  <span
                    className={
                      'ml-auto h-1.5 w-1.5 rounded-full ' +
                      (layers[key] ? 'bg-earth' : 'bg-edge2')
                    }
                  />
                </button>
              ))}
            </div>
          </details>
        </>
      )}

      {tab === 'missions' && (
        <div className="flex-1 overflow-y-auto p-2">
          <PayloadFilter missions={missions} selected={kindFilter} onSelect={setKindFilter} />
          {!missions.some(m=>matchesMission(m)&&(!kindFilter||m.payloads?.some(p=>p.kind===kindFilter)))&&<p className="p-2">No matching missions.</p>}
          {missions.map((m, i) => {
            const active = missionIdx === i
            const matches = kindFilter === null || (m.payloads ?? []).some((p) => p.kind === kindFilter)
            const landed = m.status === 'flown' || m.status === 'partially-flown'
            if (!matches || !matchesMission(m)) return null
            return (
              <button
                key={m.name}
                onClick={() => onMission(i)}
                className={
                  'mb-1 w-full rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ' +
                  (active
                    ? 'border-sun/50 bg-sun/[0.08]'
                    : 'border-transparent hover:border-edge hover:bg-panel2/70')
                }
              >
                <div className="flex items-center gap-1.5">
                  <Rocket
                    className={
                      'h-3 w-3 shrink-0 ' + (landed ? 'text-viable' : m.status === 'cancelled' ? 'text-danger/70' : 'text-sun/80')
                    }
                  />
                  <span
                    className={
                      'truncate text-[12px] font-medium ' +
                      (active ? 'text-sun' : 'text-ink/90')
                    }
                  >
                    {m.name}
                  </span>
                  {m.unconfirmed && <span className="shrink-0 text-[12px] uppercase tracking-wide text-inkdim" title="Details could not be verified from two independent sources">unconfirmed</span>}
                </div>
                <div className="mt-1 flex items-center justify-between text-[12px]">
                  <span className="truncate text-inkdim">{m.provider}</span>
                  <span
                    className={
                      'shrink-0 rounded px-1 py-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] ' +
                      (m.status === 'flown' ? 'bg-viable/15 text-viable'
                        : m.status === 'partially-flown' ? 'bg-viable/10 text-viable/90'
                        : m.status === 'cancelled' ? 'bg-danger/10 text-danger/90'
                        : 'bg-sun/10 text-sun/90')
                    }
                  >
                    {m.status}
                  </span>
                </div>
                {m.landingUTC ? (
                  <div className="mt-0.5 font-mono text-[12px] text-inkdim">
                    {m.landingUTC.slice(0, 10)} · touchdown
                  </div>
                ) : (
                  (m.target || m.launchWindow) && (
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px]">
                      <span className="truncate text-inkdim">{m.target ?? 'Target TBA'}</span>
                      {m.launchWindow && (
                        <span className="shrink-0 font-mono uppercase tracking-wide text-sun/70">
                          {m.launchWindow}
                        </span>
                      )}
                    </div>
                  )
                )}
              </button>
            )
          })}
          <p className="px-2 py-2 text-[12px] leading-relaxed text-inkdim">
            {missions.length} CLPS deliveries, 2024–2030: flown, announced, and
            cancelled. Flown missions include estimated Sun geometry at
            touchdown. Upcoming markers show target regions, not landing
            ellipses; "unconfirmed" marks single-source details. Consult the
            linked mission sources for current schedules.
          </p>
        </div>
      )}

    </aside>
  )
}
