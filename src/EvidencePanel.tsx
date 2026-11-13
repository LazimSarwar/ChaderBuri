import { ExternalLink, X } from 'lucide-react'
import type { Ephemeris, Horizon, Site } from './data'
import { FieldProbe } from './FieldProbe'
import { BenchmarkPanel, useBenchmarkReports } from './BenchmarkPanel'
import { ValidationSummary } from './ValidationSummary'
import { ResidualsPanel } from './ResidualsPanel'
import { UncertaintyPanel } from './UncertaintyPanel'
import { TransitionPanel } from './TransitionPanel'
import type { PredictionIndex } from './lib/predictionIndex'
import { ASTRONAUT_EYE_HEIGHT_M } from './lib/astronautMotion'

export function EvidencePanel({ site, ephemeris, horizon, onClose, onValidation, onExploreReference,index,eph,horizons }: {
  index:PredictionIndex;eph:Record<string,Record<'sun'|'earth',Ephemeris>>;horizons:Record<string,Horizon>
  site: Site; ephemeris: Ephemeris; horizon: Horizon; onClose: () => void; onValidation: () => void; onExploreReference: () => void
}) {
  const p = ephemeris.provenance
  const benchmark = useBenchmarkReports(index)
  const source = (title: string, url: string) => <a className="inline-flex items-center gap-1 text-earth underline underline-offset-4" href={url} target="_blank" rel="noreferrer">{title}<ExternalLink size={12} /></a>
  return <section role="region" aria-label="Data and evidence" className="workspace-modal">
    <header className="workspace-heading"><div><p className="eyebrow">Chader Buri / Evidence</p><h2>Know what supports the answer.</h2></div><button data-panel-close className="tool-button" onClick={onClose} aria-label="Close evidence"><X size={18} /></button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8">
      <div className="mx-auto max-w-5xl">
        <p className="max-w-3xl text-sm leading-7 text-inkdim">Chader Buri combines predicted celestial positions, measured lunar topography, and your hardware assumptions. It is a screening tool for comparing choices. A passing result means the enabled model requirements are met.</p>
        <ValidationSummary state={benchmark} index={index} onValidation={onValidation}/>
        <div className="my-6 grid gap-4 md:grid-cols-3">
          <article className="evidence-card"><p className="eyebrow text-sun">01 / Predicted geometry</p><h3>JPL Horizons</h3><p>Sun and Earth positions, angular sizes, and observer distances. Cached hourly predictions—not spacecraft telemetry.</p>{source('Horizons documentation', 'https://ssd.jpl.nasa.gov/horizons/manual.html')}</article>
          <article className="evidence-card"><p className="eyebrow text-earth">02 / Observed terrain</p><h3>LRO · LOLA</h3><p>Laser altimetry produces the elevation model. Chader Buri samples it into a 360° horizon at each supported site.</p>{source('LOLA archive', 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm')}</article>
          <article className="evidence-card"><p className="eyebrow text-viable">03 / Your assumptions</p><h3>Electrical simulation</h3><p>Array geometry, load, conversion losses, initial charge and reserve. The model integrates energy hour by hour.</p><button onClick={onValidation} className="text-left text-earth underline underline-offset-4">Inspect consistency checks →</button></article>
        </div>
        <p className="text-xs text-inkdim">Dataset {index.datasetId.slice(0,12)} · model {index.model.version}. Analysis observer {index.analysisObserverHeightM} m above DEM ground; standing exploration eye height {ASTRONAUT_EYE_HEIGHT_M} m.</p>
        <BenchmarkPanel state={benchmark} onExplore={onExploreReference} />
        <TransitionPanel index={index} eph={eph} horizons={horizons}/>
        <ResidualsPanel />
        <UncertaintyPanel />
        <div className="grid items-start gap-6 md:grid-cols-2">
          <section className="evidence-card"><h3>{site.name}</h3><dl className="evidence-list">
            <dt>Coordinate frame</dt><dd>{p?.frame ?? 'Legacy cache; no embedded provenance'}</dd>
            <dt>Observer</dt><dd>{site.lat}° latitude · {site.lonEast}° east longitude<br />{p ? `${p.observer.heightKm.toFixed(3)} km above reference sphere` : 'Unrecorded cache elevation'}</dd>
            <dt>Observer height</dt><dd>{p?.observerHeightAboveGroundM ?? 'Unrecorded'} m above DEM ground</dd>
            <dt>Coverage</dt><dd>{ephemeris.start} → {ephemeris.stop} UTC</dd>
            <dt>Sampling</dt><dd>{ephemeris.stepHours} hour · {(ephemeris.rows.length - 1).toLocaleString()} intervals</dd>
            <dt>Fetched</dt><dd>{p ? new Date(p.retrievedUTC).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Not recorded'}</dd>
            <dt>Terrain</dt><dd>{horizon.dem} · 1° azimuth bins<br />20 m or 120 m DEM sampling, {horizon.rayExtentKm ?? 160} km ray extent</dd>
          </dl>{p && <details className="mt-4 text-xs text-inkdim"><summary>Source query & response fingerprint</summary><p className="my-3 break-all font-mono">SHA-256 {p.rawSha256}</p>{source('Reproduce this Horizons query', p.url)}</details>}</section>
          <div className="space-y-4"><FieldProbe site={site} horizon={horizon} /><section className="evidence-card"><h3>What remains uncertain</h3><ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-inkdim">
            <li>Footprints use discrete terrain samples. Intervening obstacles and lander self-shadowing remain unresolved.</li>
            <li>Hourly sampling can miss short transitions. The solar disc uses a locally level ridge approximation.</li>
            <li>Earth-centre visibility does not establish an RF link, antenna pointing, relay access or a DSN booking.</li>
            <li>Optional thermal screening uses a single warm node and assumed environment. Battery temperature dependence, ageing and peak-current limits remain unmodeled; no flight qualification is claimed.</li>
            <li>Explore progressively loads measured elevations at the displayed resolution. Colour textures are illustrative; individual rocks are unresolved.</li>
          </ul></section></div>
        </div>
        <section className="evidence-card mt-6"><h3>The space view</h3><p>The Sun, eight planets and 12 selected moons share one ICRF coordinate frame. Parent-relative JPL position and velocity samples are interpolated with cubic Hermite curves. NAIF SPICE orientations rotate each body and its sunlight direction. Coverage: 1 September 2026 to 31 December 2028 UTC.</p><p>These are geometric simultaneous positions, without light-time or aberration. Orbit lines are instantaneous two-body guides. Sizes of distant disks may be enlarged; distances stay linear. Surface textures are historical composites with authored color and gap fills. Clouds, weather, solar activity and texture colors are illustrative, not live observations. The backdrop is a procedural star field of about 9,600 catalog-free points; the Deep sky control only brightens it. It is a visual backdrop, not an astrometric star chart.</p><div className="flex flex-wrap gap-4">{source('Scene data & kernel provenance','/data/space/manifest.json')}{source('Texture sources & fingerprints','/data/space/assets.json')}{source('NAIF SPICE','https://naif.jpl.nasa.gov/naif/')}</div></section>
        <p className="mt-6 text-xs leading-6 text-inkdim">Visualization: {source('NASA 3D Resources','https://github.com/nasa/NASA-3D-Resources')}, {source('NASA Earth imagery via three.js', 'https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets')} and {source('Solar System Scope / INOVE','https://ssi.solarsystemscope.com/textures/')} (Moon, Mercury, Venus clouds, Jupiter, Saturn and its rings, Uranus, Sun and Milky Way; unchanged files, CC BY 4.0). Solar irradiance uses {source('NASA’s 1361 W/m² reference', 'https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science')} at 1 AU, scaled by observer distance. Chader Buri is an independent project, with no NASA endorsement.</p>
      </div>
    </div>
  </section>
}
