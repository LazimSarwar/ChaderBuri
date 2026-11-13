# Landsight screening model

## Data and definitions

JPL Horizons supplies topocentric Sun/Earth azimuth and elevation. NASA LRO LOLA
GDR supplies the terrain masks. A 360-entry mask is sampled at the nearest whole
azimuth degree, with half-degree ties rounded upward in Python and JavaScript.
Sun/Earth centre elevation must be strictly greater than the mask to count as
visible. Duty-cycle statistics exclude eclipses and use complete hourly intervals,
with the left endpoint representing each interval. The final cache sample closes
the last interval. Current coverage is 2026-09-01 to 2028-12-31 UTC.

Binary visibility and electrical power answer different questions. The UI's
"grazing" label describes a partially exposed disc; it is not a binary visibility
override. Electrical power includes partial-disc exposure even when the centre
is below the ridge, subject to the chosen panel's incidence angle.

## Solar exposure

Solar angular radius comes from Horizons quantity 13 (apparent angular diameter). With clearance c and radius r,
let x = clamp(c/r, -1, 1). The visible disc fraction above a locally straight ridge is

`f = [acos(-x) + x sqrt(1-x²)] / pi`.

This assumes uniform disc brightness and a locally horizontal silhouette. It does
not resolve terrain variation across the disc. Earth occultation uses the two-circle
overlap formula with Horizons apparent Earth and Sun radii. Atmospheric
scattering, refraction and limb darkening are omitted.
For simultaneous partial terrain and eclipse masks, we use the conservative
intersection bound `max(0, terrainFraction + eclipseFraction - 1)`. Relative
mask orientation is unresolved, so this can underestimate exposure.

With observer-to-Sun distance d in AU, electrical generation in watts is

`Psolar = 1361 / d² × area_m² × cell_efficiency × incidence × available_disc_fraction`.

For horizontal panels, incidence is `max(0, sin(elevation))`. For fixed panels
with tilt from horizontal and facing azimuth, it is
`max(0, sin(el) cos(tilt) + cos(el) sin(tilt) cos(sunAz - panelAz))`.
Ideal tracking uses incidence 1, including when the local geometric horizon is
below horizontal. Partial-disc incidence uses the centre ray. Pointing stops,
structure self-shadowing, dust, temperature and radiation damage are not modeled.

The 1361 W/m² reference is from [NASA solar irradiance science](https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science).
[JPL's solar power lesson](https://www.jpl.nasa.gov/edu/resources/lesson-plan/calculating-solar-power-in-space/)
provides context on area, efficiency and distance.

## Battery energy balance

The comparison's solar-generation difference is a decomposition of the same hourly
model, not an independently observed cause. With identical electrical settings and
duration, corresponding mission-relative hours have three factors: inverse-square
flux scale, panel incidence, and the combined terrain/eclipse available fraction.
Replacing these factors from baseline to alternative in all six orders and averaging
each marginal contribution gives symmetric contributions whose sum is exactly the
modeled generation difference (up to floating-point rounding). This avoids selecting
one arbitrary replacement order. Terrain and eclipse contributions remain combined.
The decomposition does not explain minimum battery charge, heater demand or RF
availability; those depend on additional modeled assumptions and time ordering.

All capacity and energy values are Wh; demand and generation are W. Each cached
hour is integrated as constant power for one hour. Solar generation supplies the
load directly. For a surplus, accepted energy is limited by remaining storage
divided by charge efficiency; excess is curtailed. For a deficit, storage draw
equals the deficit divided by discharge efficiency, capped by available storage.
The remainder is unmet demand. Conversion losses are tracked separately.

At each interval boundary (including the initial state), stored energy must stay
at or above the user-set reserve. Any unmet demand fails the energy requirement,
even with a zero reserve. Equality at reserve passes. The minimum includes the
initial charge. Reserve/depletion events are linearly located within the constant
hourly step; displayed minutes do not imply minute-resolution ephemerides.
After depletion, calculation continues with the requested demand to quantify the
shortfall. It does not predict that the lander will recover or survive.

The model has no charge/discharge power limits, battery temperature dependence,
voltage curves, peak loads, or battery ageing. Survival heating is handled by the
optional thermal model below rather than folded blindly into constant demand.
Defaults are examples, not specifications for any NASA or CLPS vehicle.

## Night-survival thermal model

An optional single-node lumped-capacitance model. One warm electronics/battery
node at temperature T (K) is integrated hour by hour over the mission window:

    C · dT/dt = Q_internal + Q_solar + Q_heater − Q_radiative

where C is the thermal capacitance (mass × specific heat); Q_internal is the
chosen fraction of electrical demand dissipated inside the controlled zone;
Q_solar = α·A · S · fluxScale · max(0, sin elevation) · visible-fraction, reusing
the same solar geometry as the power model; Q_radiative = (εA)_eff · σ · (T⁴ −
T_sink⁴) with σ the Stefan–Boltzmann constant; and Q_heater is a thermostatic
heater that supplies whatever is needed to hold the setpoint, clamped to
[0, heater max]. The step is semi-implicit (radiation linearized about the current
temperature), so it is unconditionally stable for any configuration. The node
starts at the setpoint.

Two outcomes follow. If the heater saturates and the node still falls below the
survival floor, the window fails on survival. Otherwise the heater holds the
setpoint, and its hourly draw is added to battery demand — so survival heating is
charged to the same battery as every other load, and a window that passes on
battery alone can still fail once the cold forces the heaters on. Survival shares
the solver's normalized-slack ranking with the visibility and battery constraints;
the smallest slack names the limiting constraint.

Limitations: a single node has no internal gradients, no transient electronics
duty cycling, and no contact (regolith) conduction beyond the one radiative sink.
The sink temperature is a representative value in the LRO Diviner south-pole range,
not a per-site measurement; survival and setpoint are generic, not vehicle
specifications. `npm run verify:thermal` checks steady-state hold, unheated
cooling and freeze, parameter monotonicity, solar warming, stiff-case stability,
and that heater draw raises battery demand and only removes windows.

## Search, explanations and sensitivity

Every candidate starts on a six-hour grid within the chosen date range and must
fit completely within the cache. Search evaluates every hour in the requested
mission. Passing windows satisfy all enabled visibility and energy constraints.

Ranking maximizes the minimum normalized slack: percentage-point margins divided
by 100, outage-hour margins divided by mission hours, and battery reserve-point
margin divided by 100. For unmet energy, battery margin is additionally bounded
by `-unmetWh / capacityWh`. This is a transparent ranking heuristic, not reliability
or a probability. Ties between opportunity groups prefer more passing sampled
starts, then earlier starts, then site slug. Within a group, ties keep the earliest
best start. A group connects passing sampled starts; unsampled start times are not
guaranteed to pass.

Explanations name all violated requirements, or the tightest passing constraint
and its physical-unit margin. Sensitivity checks re-evaluate the selected landing
at ±6 hours and at 20% greater constant demand. They do not perturb terrain,
position or observer height and are not confidence intervals.

## Validation scope and remaining uncertainty

- Battery tests verify analytic cases, conservation, monotonicity, boundaries and
  integration with the mission search. Eclipse tests compare with numerical area
  integration. Solver tests compare statistics and brute-force searches.
- Querying Horizons again checks source/cache consistency, not an independent
  astronomy model. Historical touchdown Sun elevation is a qualitative geometry
  check, not a reconstruction of terrain, spacecraft orientation, or failure causes.
  Athena's provider cited Sun direction, panel orientation and cold conditions:
  [Intuitive Machines mission statement](https://investors.intuitivemachines.com/node/9481/pdf).
- Terrain masks use LOLA 20 m/120 m products, one-degree azimuths and a finite
  ray-march range. The nominal published-region comparison and the 100-clone
  uncertainty ensembles are complete; a fully matched independent external
  illumination validation is still not established. Coordinate, height and near-ridge sensitivity remain
  necessary before stronger scientific claims.
- The 12 October 2026 refresh uses four-decimal terrain coordinates and DEM ground
  elevation relative to the 1737.4 km reference sphere, with zero observer height
  above ground. Horizons uses its DE421 lunar mean-Earth coordinate convention
  and DE441 ephemeris. Each file embeds its query, retrieval time and raw-response
  SHA-256. Matching inputs does not imply 20 m prediction accuracy.
- Earth-centre clearance is not station-specific visibility or a link budget.
  The separate DSN display includes approximate station geometry and an illustrative
  X-band budget (see below). It does not reserve capacity or establish operational service.
- The regional atlas uses an azimuthal equidistant south-pole map, 90°S at its centre and 84°S at its edge, with 0°E up and east clockwise. Only numbered sites have computed visibility results; intervening terrain is not a prediction surface. The hillshade uses illustrative northwest lighting.

Sources: [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/),
[LOLA GDR](https://pds-geosciences.wustl.edu/missions/lro/lola.htm).


## Reproducibility and design alternatives

Production analysis uses a ground-level observer (0 m); the exploration camera has
a chosen eye height of 1.7 m above its feet, with additional altitude during a jump.
The visit is a visualization, not a separate visibility prediction at the camera.
Per-site sensitivity reports recompute masks at 0, 1, 3
and 5 m using the same LOLA DEMs and marching method. Apparent target directions are
translated along local up with the cached target range; light-time is not recomputed.
These cases describe sensitivity to height, not uncertainty probabilities or certified
mast performance. The 0 m case reproduces the nominal horizon and mission verdict.

The surface camera can move within 250 m of the selected target, using a reference-
sphere exponential map and sampled loaded DEM heights, with a 1.7 m standing eye height.
This does not relocate the planner's coordinate, recompute its terrain horizon or
assess traversability. Cached skyline markers, Sun-path classifications and HUD
visibility remain referenced to the landing target. The skyline activity therefore
requires returning to that target. Sun/Earth activities identify directions even
when the cached target is masked; completing an activity does not establish visibility
or radio service. Neither DEM pixels nor the illustrative surface resolve rocks.

Walking is a kinematic ground-following viewpoint at a chosen 1.4 m/s. Jumps integrate
constant gravitational acceleration of 1.62 m/s², the rounded value in the
[NASA Moon Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html).
The chosen 2 m/s vertical impulse gives h=v²/(2g)=1.235 m and t=2v/g=2.469 s on level
ground. These are illustrative controls, not predictions of suited human performance.
Vertical position uses analytic constant-g frame steps in datum metres. Feet resolve
contact with the loaded DEM; missing ground blocks movement and pauses integration.
Horizontal take-off velocity is retained until contact or the exploration boundary.
No airborne steering, double jump, drag, body collisions, gait biomechanics or
traversability assessment is modeled. A frame advances at most 0.05 s, preventing
large position changes after a stall; slow rendering can therefore slow the motion.
Hidden documents pause motion and clear movement input. No camera bob is added.
Physics runs on frame time, independent of scene UTC and playback speed. Reset/site
arrival clears flight state. Jumping does not change the cached landing horizon,
planning inputs or nominal Sun/Earth visibility verdicts.

Time journeys interpolate within the existing cache, spanning two hours around the
next terrain-mask crossing (clipped at cache bounds), or the next 24 hours. Playback
takes 12 seconds; it is not physical real-time motion. Stop retains the current scene
UTC, Restore returns to the starting UTC, and Keep dismisses the preview. Journeys
return the viewpoint to the target and stop when the document is hidden. Reduced-
motion preferences skip the animation. Immersive mode is a browser display mode;
no WebXR tracking, headset calibration or live lunar imagery is provided.

The surface **Terrain light** combines artificial raking fill and a soft head-directed
cone in the existing terrain fragment shader. It is not calibrated astronaut hardware
or an additional source of solar power. It does not change Sun vectors, cached horizon
masks, visibility states or mission results. Surface dragging continues to turn the
observer; the existing orbital inspection spot remains spatially local. The separate
contrast control remains a tone adjustment. Star-field brightness uses a dim surface
display preset, not a photometric prediction of what an astronaut's eye would see.

Procedural regolith detail varies albedo and display shading only, with no mesh
displacement or collision geometry. The style is informed by the fine, fragmental
material described in [NASA's regolith overview](https://science.nasa.gov/biological-physical/what-is-lunar-regolith/).
It does not reconstruct the grains, rocks or composition at a chosen site. Three
filtered noise bands fade with distance and pixel footprint. A lunar-body coordinate
anchor keeps the pattern continuous when terrain patches recenter, using a 64 m
periodic domain; repetition and unresolved detail are rendering limitations.

The field probe casts a maximum 2 km ray into the loaded terrain mesh, ignoring
decorative materials and visitor flags. Coordinates are transformed back into the
lunar body frame. Datum elevation and pixel spacing use the finest loaded DEM with
a valid height at that point; exports retain its product key, source and original
source hash. Reported slope is the angle of the intersected mesh face to local radial
up. It is a rendered-facet value, affected by LOD/triangulation, not a hazard map or
certified slope estimate. It cannot identify soil chemistry or rock-scale hazards.
Skyward/unavailable probes return a message rather than invented measurements.

Survey flags are visitor annotations placed at the grounded viewpoint, not existing
lunar hardware. Eight recent flags are kept in memory across sites until reload.
The field notebook exports the current site's flags and last valid inspection with
scene-row, recording/export UTC, dataset/model identity and scope. Jumping prevents
flag placement. The planner remains at its selected landing coordinate and height;
neither probes nor virtual flags create new mission forecasts.

Six targeted 24-hour JPL queries at ten-minute spacing cover selected Sun/Earth
transitions at Shackleton, Malapert and de Gerlache. Reports preserve query URLs,
retrieval times and raw-response/source-product hashes. They assess interpolation
against finer samples from the same source, not independent terrain/ephemeris accuracy.
They do not bound every site, date or sub-ten-minute event. Event timing evaluates
interpolated azimuth/elevation against the discrete mask and refines the state change;
linear clearance interpolation across mask-bin steps can give incorrect event times.
Hourly mission energy integration remains unchanged.

No numerical timing uncertainty bound is established. The retired heuristic
divided one degree of azimuth sampling by a median elevation rate and capped the
display at 24 hours. Azimuth sampling is not an elevation-error estimate; this
quantity was not a defensible confidence interval. The UI and brief now describe
the hourly integration, discrete skyline and possible missed short events instead.

The older ablation report's centre-versus-50%-disc comparison is an equivalent
threshold under its straight-ridge model. Its ten-minute rows interpolate the hourly
cache. Neither comparison establishes an independent timing or model-error bound.

The generated prediction index binds source bytes and the numerical source-file
fingerprints. Runtime loading verifies source SHA-256 and the indexed coverage grid;
a model/index mismatch is rejected. Mission brief and comparison JSON exports contain
this identity, UTC bounds, editable assumptions and the assessment scope. Fingerprints
identify inputs; preserve those inputs to reproduce an older deployment.

`npm run verify:evidence` checks all 572,572 Sun/Earth samples for complete hourly
coverage, finite/ranged quantities and agreement with terrain observer metadata.
It also checks source response parsing, azimuth wraparound, inverse-square flux,
analytic electrical design limits, scenario input bounds and proxy error paths.
These are consistency/regression checks, not an independent accuracy benchmark.

Design alternatives are independent one-variable searches: capacity 1–1,000,000 Wh,
load 0–10,000 W, area 0–100 m². Search rounds toward a feasible result (1 Wh,
0.1 W, 0.01 m² respectively) and re-simulates it. Every other setting remains fixed.
If the initial charge is below reserve, no alternative can pass. A null result
means that setting alone cannot repair the window within the search bounds.
The alternatives satisfy electrical constraints only, with no engineering margin.

Mission brief JSON contains a schema version, generation timestamp, source queries
and fingerprints, terrain profile, constraints, trace, explanation and sensitivity.
Scenario links contain user assumptions and selection, not results; opening a link
recalculates against the deployed dataset. A later dataset refresh can change the
result. Preserve the exported brief to identify the original source snapshot.

The integrated 3D scene uses JPL parent-relative geometric vectors in ICRF, sampled at 6 hours for planets and 0.5–2 hours for satellites. Cubic Hermite interpolation uses both positions and velocities. SPICE supplies hourly attitudes (`MOON_ME_DE421` for Moon, IAU frames for other bodies), interpolated by quaternion slerp. UTC is converted to ET for attitude evaluation. NAIF PCK radii set oblate/ellipsoidal shapes; no detailed shape mesh is claimed for irregular satellites. The manifest identifies every source and kernel. All 21 bodies cover the full planning interval.

The scene is simultaneous geometric geometry, without observer light-time/aberration. Its direction comparison against site-based apparent Horizons products stays within 0.006° at 72 sampled target/site/epoch combinations; this is a consistency comparison, not independent validation of either JPL product. Images are historical appearance composites with authored colors/gap fills, and the Milky Way panorama is not an astrometric chart. Per-body sunlight fixes the bright hemisphere but does not render inter-body eclipse shadows. Exposure, atmospheric rim, small night-side fill and normal-map relief are illustrative. The electrical model remains separate and includes its own geometric solar-disc eclipse mask. Saturn's ring map uses a simplified analytic planet shadow.

Orbit guides use μ = GM_parent + GM_body from the NAIF kernel and are osculating two-body ellipses evaluated from the nearest cached state and refreshed per displayed day; they do not predict a complete perturbed orbit. Planets/satellites move on interpolated JPL vectors, never on those guides. Distances remain linear. An optional minimum screen diameter enlarges unresolved bodies for selection; distant moons are enhanced only when exploring their parent. The lunar-sky preset disables this enhancement and uses a narrow field of view from a virtual near-side vantage initially 43.4 km above the reference sphere. It is not tied to a landing-site DEM.


The terrain sampler uses zero-based pixel centres, with the pole at `n/2 - 0.5`
according to the local PDS label offsets. Bilinear interpolation applies no extra
half-pixel shift. Site coordinates are rounded once to four decimals before both
the DEM height and horizon are computed; ground elevation is rounded to a metre
before constructing the observer. The Horizons observer uses that same elevation.
The horizon march extends 160 km, with increasingly coarse radial steps; the DEM
pixel spacing is not the radial step size. That distinction matters for unresolved
obstacles. Synthetic pixel-centre and projection round-trip tests check the sampler,
without establishing external terrain accuracy.

## Landing dispersion and local surface inspection

`scripts/build_landing_terrain.py` preserves the nominal sites and generates 19
terrain masks per site: centre, six samples at 125 m, twelve at 250 m. Destinations
follow great circles on the 1737.4 km reference sphere; each offset uses its own
bilinearly sampled LOLA ground elevation and a 360-degree, 160 km horizon march.
The centre reuses the existing horizon exactly. Primary DEM and nominal horizon
SHA-256 fingerprints are recorded, as are mesh/UV fingerprints. Run
`npm run data:landing` after changing nominal sites or terrain products.

The browser translates nominal apparent topocentric target vectors using their
cached ranges into each nearby observer's local frame. It does not independently
query Horizons or recompute differential light-time/aberration at each offset.
This local sensitivity approximation must not be advertised as independently
validated offset ephemerides. Each sample uses the same visibility, solar-disc,
eclipse and battery definitions as the nominal window. ROBUST means all 19 pass;
MARGINAL means mixed; FRAGILE means none pass. These labels are neither landing
probabilities nor proof of continuous footprint safety. No slope, rock, touchdown
dynamics or thermal certification is inferred. The coarse IM-1 product is 120 m;
all other current products are 20 m, which limits meaningful terrain detail.

The headline and detailed panels share one assessment of the indexed footprint
and height products. The footprint excludes thermal/RF even when thermal is
enabled for the nominal mission; the height cases retain enabled nominal
requirements. A missing or failed diagnostic remains unavailable, never a pass.
Print reports independently recompute the selected mission and its exact seven-day
slip with unchanged hardware. Out-of-cache missions are explicitly not assessed.
Comparison cards use the same indexed diagnostics for each scenario's actual site,
landing and constraints. Their JSON and printable comparison brief retain those
assessments separately from the nominal verdict, including loading/unavailable
states. Comparison briefs preserve all configured A/B/C scenarios and disclose
each scenario's own assumptions, rather than implying shared hardware or a fixed
seven-day difference. Previewing a scenario changes only the scene site/date and
mission-window highlight, stops playback and retains comparison inputs.

The continuous Explore view retains one canvas and camera from globe to ground.
A surface-relative floating origin permits metre-scale camera distances. Nested,
stitched meshes bilinearly sample real LOLA elevations, retaining curvature.
Global LDEM16, 120 m and 20 m south-pole products transition to the authors' 5 m
Connecting Ridge product only within its coverage. The camera readout reports
source pixel spacing, not current mesh spacing or actual optical resolution.
NASA's interpolated 5 m product contains gaps between tracks; pixel size does
not imply resolved 5 m hazards. Global colour is illustrative at close range.
No procedural rocks or invented local photography are presented as measurements.

The inspection beam and directional shadow map affect rendering only. Visual
shadow-map precision and mesh LOD do not define mission illumination. The beam
brightens dark facets without changing the separate horizon, eclipse, energy or
battery calculations. Scene stars and Sun emission are exposure effects.

## Relay orbit design

The optional relay panel propagates a hypothetical circular two-body lunar orbit
using NAIF lunar GM. Altitude is relative to the 1737.4 km reference sphere.
Inclination and node are defined relative to the Moon's equator/meridian at the
chosen landing epoch; phase is reset at that epoch. The plane remains fixed in
ICRF, and cached SPICE orientations convert it into the rotating Moon frame.
Five-minute left-endpoint sampling checks local terrain clearance for the relay
and reference-sphere occultation for the finite relay-to-Earth segment. Hourly
apparent Earth vectors are interpolated. Combined availability is the logical
union of direct and relay geometry, never the sum of their percentages.

The optional landing-phase explorer evaluates 24 otherwise identical orbits at
15-degree starting-phase increments. Its highlighted design first minimizes the
longest combined direct-or-relay outage, then maximizes total combined
availability, with the smaller phase as a deterministic final tie-break. This
is a discrete sensitivity sweep, not an orbit optimizer; it does not vary
altitude, inclination, node, spacecraft hardware or service assumptions.

This is a scenario design calculation, not Lunar Pathfinder or Gateway tracking.
It excludes perturbations, antenna limits, link budget, payload/radio operation,
satellite power and service scheduling. Sub-five-minute events may be missed.
Relay results do not silently replace the planner's direct-link requirements.
[ESA's current Pathfinder update](https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Lunar_Pathfinder_Europe_s_first_step_towards_a_connected_Moon)
states a planned 2027 launch (checked 13 October 2026).

## Completed published-region comparison

See `public/data/benchmark/barker2021-roi4.json` and `scripts/build_benchmark.py`.
[Barker et al. 2021](https://ntrs.nasa.gov/citations/20205009660), Table 2 case A,
provides the external reference; [NASA PGDA](https://pgda.gsfc.nasa.gov/products/78)
provides original region boundaries and elevation pixels. The calculation covers
all 532 ROI 4 pixel centres, 1 January 2024–1 January 2026, hourly, at 1 m and 5 m.
Each pixel has 720 horizon azimuths. Region area is source pixel area, including
boundary centres, rather than polygon geometric area.

This is a nominal regional comparison. It uses a uniform solar disc, nominal
terrain, geometric DE440 Sun vectors, 5 m near-field and 20/120 m far-field to
220 km. The paper uses uncertainty clones, limb darkening and different far-field
products. Longest intervals are calculated per pixel and then averaged over the
region. The panel compares these nominal means with the published conservative
percentiles and reports differences, without a fabricated acceptance tolerance.
The 1 m discrepancy is characterized by the completed ensembles below. Source,
kernel and paper fingerprints make the calculation auditable; a flight-grade
external validation remains open.

**Reference ensemble, recalculated 10 November 2026.** A November audit found that
terrain within a few hundred metres of each observer had been sampled only every
5 m, which made the 1 m results too high. The reference ensemble (100 original
terrain clones, nominal 20/120 m far field, uniform solar disc) was recalculated
with 0.25 m sampling within 500 m and is the primary comparison. On the same
statistic as Barker Table 2 (case A, ROI 4) it gives, at 1 m, a mean
illumination of 71.07% against 69.61% (+1.46 pp), longest illumination 138.47 d
against 136.49 d (+1.98 d) and longest darkness 14.33 d against 13.27 d
(+1.06 d); at 5 m, 88.20% against 88.12% (+0.08 pp), 231.59 d against 231.20 d
and 3.99 d against 4.00 d. A per-clone audit of all 100 reports (generator, proof
and worker fingerprints; independent percentile recomputation) passed. About
1.46 pp at 1 m remains unexplained; one untested candidate is how the 5 m clone
rasters are interpolated. The earlier ~8-point figure was a statistic mismatch,
not a model error.

The matched model (legacy PDS 80/240 m terrain and a documented 550 nm Pierce &
Slaughter polynomial; wavelength matching, not proof of identical author
coefficients or code) was recalculated with the same corrected sampling and
released on 11 November 2026. At 1 m it gives 71.08% against 69.61% (+1.47 pp),
longest illumination 138.47 d and longest darkness 14.33 d; at 5 m, 88.23%
(+0.11 pp), 231.59 d and 3.99 d. It differs from the reference ensemble by
+0.015 pp at 1 m and +0.035 pp at 5 m, so the terrain-model and solar-disc
choices do not explain the remaining 1 m residual. The deep per-clone audit of
both models passed (50 checks). Exact author archive release and radial sampling
remain unverified. Per-pixel checkpoints support interruption recovery. See
`docs/BENCHMARK_AUDIT.md` for sources and method details.



Visual refinement: the optional distant Sun display is enlarged by 45%, with
closer Sun framing, limb weighting and filtered warm surface exposure. This is
an illustrative rendering of the credited texture, not live solar imagery or
true-colour radiometry. Lunar-sky mode retains the physical disk scale.
Terrain generation yields between bands and reuses scalar face calculations.
Idle rendering uses demand mode; camera flights and playback request frames.
The GPU star panorama uses a 4096-pixel-wide copy of the original credited image.


Sun reference update: inspected simonvse/NEO-Orrery's unlit sphere, `8k_sun.jpg`
texture (4096 x 2048 actual pixels) and exponential billboard haze. The exact texture is independently
obtained from Solar System Scope under CC BY 4.0; its SHA-256 matches the
reference asset. MeshBasicMaterial uses the credited texture with warmer colour,
stronger contrast and procedural fine granulation inspired by the supplied
reference photograph. Added granulation is illustrative, not measured solar
features or live imagery. A narrow golden-orange limb and compact amber halo
are display effects.
The distant Sun blends into an overexposed white-gold disk with a warm glare
and lens rays; zooming closer smoothly restores the illustrative detailed view.
The blend uses apparent pixel size, not a change to solar luminosity or mission
lighting. This is a camera-exposure illustration, not a calibrated optical model.
Reference: https://svs.gsfc.nasa.gov/vis/a010000/a013800/a013859/script_31299_00.html
No unlicensed repository implementation is vendored. JPL positions, radii and
SPICE orientation remain Landsight's existing physical model; glow is visual.

Benchmark audit: see `BENCHMARK_AUDIT.md`. The recomputed nominal metrics are unchanged; derived-cache fingerprints and raster-centre checks improve reproducibility, not external accuracy.

## Astronaut expedition scope

Grounded visitor traces use the loaded rendered terrain, a 0.7 m sampling threshold
and a 240-sample cap. The optional line is a memory aid, not a safe-route assessment.
Distance is tracked horizontal movement, not EVA odometry. Crouching selects a
1.1 m eye height and half walking speed; standing uses 1.7 m. Suit dynamics, gait,
body collisions and small-scale rocks remain outside the movement model.

Equipment stands at illustrative offsets beside the target. Panel output reuses
the mission model's solar-disc/terrain/eclipse mask, distance-scaled flux and
fixed-panel incidence, with 2 square metres at 28% efficiency. Display light adds
no power. Antenna pointing reports angular error to Earth's centre and cached
centre clearance; it does not compute an RF link budget or a new visitor horizon.

Planner handoff compares ideal tracking and the chosen fixed orientation at the
same target and rounded scene hour: 14 days, 2 square metres, 28%, 100 W load,
10 kWh storage and default battery loss/reserve settings. It opens editable
scenarios without changing saved hardware presets and discloses these inputs.

JPEGs capture the rendered simulation with a permanent site/scene-UTC/lighting
footer. Journal JSON retains capture UTC, viewpoint/stance, equipment, notes and
dataset/model identity. Six images are held in session memory; removed images
release their object URLs. Images are not live lunar photography. Assignments
verify fresh field-task evidence, not mission feasibility or EVA safety.

## DSN station geometry and X-band budget

Station elevations for Goldstone, Madrid and Canberra are precomputed from one
live Horizons observer query per complex (Earth body-fixed ITRF93 station
coordinates, DE441, hourly across the cached window;
`scripts/build_dsn_geometry.py`). Inside the window the precomputed series is
authoritative; the Astronomical Almanac analytic formula in `src/lib/dsn.ts`
remains the fallback outside it. The builder records analytic-vs-Horizons
deltas (max 0.86 degrees across complexes; the analytic formula is documented
as ~0.3-degree class). Contact states are distinct: station below mask,
station geometry only, and RF target met. The last state requires the lunar
terrain ray to clear, the station to exceed the 6-degree screening mask, and
the selected 34 m BWG or 70 m receive aperture to support the user-selected
information rate.

The X-band budget uses DSN 810-005 module 206E table 6 typical G/T at 45-degree
elevation and CD=0.50 weather: 54.6 dB/K for a 34 m BWG and 61.7 dB/K for a
70 m antenna. Because G/T already includes atmospheric and receiver noise at
that reference condition, the model does not subtract atmosphere again. Its
`10 log10(sin(el) / sin(45 deg))` elevation adjustment is explicitly a
screening approximation, not a DSN performance curve. Power-limited rate is
capped by module 206E's standard 1.4 MHz X-band telemetry channel and the
idealized 0.5 information bit/s/Hz of BPSK rate-1/2 (700 kbps before framing
overhead). EIRP, pointing loss, required Eb/N0 and margin are disclosed
assumptions. It remains a screening budget, not an antenna assignment, DSN
booking or service commitment. Source:
https://deepspace.jpl.nasa.gov/dsndocs/810-005/206/206E.pdf.
Run `npm run verify:dsn`.


## Exploration-to-decision lesson

The guide and assignment reflection use the production buildSeries/evaluateWindow
pipeline at the nominal site coordinate and cached observer height. The starting
scene row is explicitly rounded to an hourly landing epoch; B is exactly 168 hours
later. Both missions are 14 days with the reference 3.08 m2 / 28% tracking array,
1,200 W constant demand, 10 kWh battery, default charge/discharge settings and
60% sunlight/Earth visibility, 72 h darkness/Earth-outage limits. No thermal or RF
requirement is enabled. The planner handoff preserves these exact scenarios and
supplies separate robustness products.

If both dates fail, the lesson recommends neither. A passing date is preferred
over a failure. When both pass, it compares the solver's minimum normalized
requirement margin; differences <=1e-6 are treated as a tie. This is a nominal
screening preference, not a safety/risk probability. Incomplete windows remain
unavailable without changing dates, truncating missions or extrapolating data.

Sun previews use the existing hourly-direction crossing estimator, spanning up to
one hour on each side with cache bounds. Their scene date is distinct from the
frozen comparison starting epoch. The camera returns to the target for a preview;
its eye height still differs from the cached analysis height. The target annotation
marks a coordinate, not flown hardware or a surveyed landing ellipse. Walking and
crouching do not recompute a local horizon.

Assignment debrief schema 2 retains the visitor's choice/reason, review UTC,
starting decision epoch, both complete numerical results/assumptions (or explicit
null coverage gaps), target coordinates/analysis height, field evidence and data/
model identity. It does not grade EVA safety or certify mission feasibility.

Completed field assignments retain a timestamped task-evidence snapshot (without
image object URLs). Later movement or a guide-induced trail reset does not undo
that historical completion; it is still field-task evidence, not EVA certification.


## Failure-focused guide preview

The preview uses evaluateWindow's limiting failed constraint. Battery timing is the
production simulatePower firstReserveH (or firstUnmetH when applicable), with the same
panel configuration, losses and any enabled thermal heater draw. A battery starting
below reserve is identified at landing. The plotted curve contains hourly endpoints;
the live cursor interpolates those endpoints and is hidden outside that scenario's
mission. The step's generation and total requested demand are displayed separately.
No new physical battery model or operational recovery prediction is introduced.

Darkness/outage previews use the longest run clipped to the mission and locate its
allowed-duration threshold. Insufficient aggregate sunlight/Earth-visibility percentages
have no single failure instant; the longest masked interval's midpoint is labelled
representative. Thermal cases use the modeled firstFreezeH. Event windows stay within
the complete mission and cache: battery event +/-4 h, other events +/-1 h, clipped at
mission boundaries. Passing, unavailable or inconsistent windows have no failure event.
These are explanatory model times, not validated timing-uncertainty bounds.

Guide verdicts call assessRobustness on the same products used by the planner, for
both frozen landing dates and identical requirements. Footprint remains visibility/
battery only (excluding thermal/RF); height uses enabled nominal requirements. These
separate sensitivities do not overwrite nominal results or the guide's nominal ranking.
Products load lazily on guide use; results and traces are memoized independently of
scene-clock ticks. Geometry within the moving visitor view is not a relocated horizon.
