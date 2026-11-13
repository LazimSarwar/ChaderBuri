# Exploration fieldwork

The surface experience supports a preliminary mission investigation: compare sites and arrivals, choose a science question, plan worksites, preview travel and task time, record observations, and return to the lander approach. It does not certify a landing or crewed EVA.

## Mission continuity and assistant context

`missionSession.ts` creates a detached snapshot of the planner's equipment and chosen requirements. The surface visor, mission readouts and scene assistant read that snapshot. Alternative-site visits retain it. Arrival previews change only the exploration scene and its snapshot, not the dashboard mission.

The readout publishes its proposed site, arrival, equipment and comparison separately from the current scene clock. Chader Buri receives the proposal when it is open. Route facts are included in the surface screen digest. AI replies continue through the existing validated evidence pipeline and opt-in action controls.

## What is calculated

- Nominal sunlight, Earth-centre visibility, battery and enabled lander thermal assessments use the existing indexed planner solver.
- The readout also exposes existing nominal DSN/X-band diagnostics and separately validated footprint/observer-height checks. A diagnostic is not a booked communication service. Sampled footprint outcomes are not success probabilities.
- Route distance and resolved segment slopes use loaded DEM samples. Missing terrain remains missing and prevents a passing terrain check.
- The time budget includes outbound travel, station tasks and return to the lander approach. Pace, maximum slope, budget and reserve are editable training assumptions.
- Excursion battery demand is calculated only when capacity, travel demand and task demand are supplied. Crew oxygen is calculated only when both usable volume and a consumption assumption are supplied. Other suit consumables and thermal control remain unassessed.
- Nearby obstruction is sampled inside the available 250 m exploration area using nominal-site sky directions. Sun-disc grazing is distinguished from full local obstruction. Earth uses centre visibility. Clear nearby terrain does not establish visibility over the distant skyline, a relay, or an RF link. The nominal horizon is never silently relocated.

The route model has its own `excursion-preview-1` identity. It is a presentation/planning estimate, separate from the protected numerical benchmark model. Geometry and budget tests validate analytic examples; they are not external mission certification.

## Excursion workflow

1. Open **Plan route**, select a science question, and add up to six visitor-selected worksites using the map or east/north inputs.
2. Review the complete route, time-tagged arrival/departure estimates, modelled nearby illumination, terrain coverage and resource assumptions.
3. Start the movement preview. It follows the existing guided-walk system. The polyline is not a surveyed or obstacle-avoiding corridor.
4. At a station, record an observation. Photographs are rendered simulation captures, not lunar imagery or composition measurements.
5. Finish the simulated task to advance the scenario clock by the chosen activity duration; continue through the worksites and return.
6. Export the excursion brief with model/data identifiers, assumptions, route estimates, observations and unassessed capabilities.

Scene-time, mission-assumption, observer-height or terrain-resolution changes invalidate an active route preview. Saved routes reopen as drafts and never restart movement. Notes and worksites stay on this browser/device. Session storage is bounded and validated.

## Science and data scope

Objectives cover a terrain deployment survey, power-worksite study and shadow reconnaissance. Worksites are user selections, not asserted geological outcrops or ice detections. A dark area is not automatically a permanently shadowed region. The catalogue distinguishes candidate-region samples from mission-associated coordinates; neither constitutes NASA approval of a landing area.

DEMs determine resolved relief. Fine soil, rocks and mission equipment remain illustrative. Terrain-map sampling adapts to source resolution instead of oversampling a 20 m DEM on a 2 m display grid, while keeping about 80 cells across each view (about 6.5 m for the whole area and 1 m for the near view on a 20 m DEM) so interpolated relief stays smooth. If the communications and sensitivity diagnostics fail to load, the mission verdict stays visible and only that section reports the error. Leaving the field view during a route preview stops the guided walk; the route reopens as a draft. Higher-resolution products require coverage/quality evaluation and their own validated data integration before they can support new scientific claims.

## Headset preview

The direct **VR** button checks immersive WebXR support. Unsupported devices receive an explanation without allocating a second graphics canvas. Supported devices can explicitly enter a separate metre-space terrain scene with stereo head tracking and controller-select teleportation on known terrain. Main exploration is paused and its mission settings are preserved.

The headset mesh preserves loaded elevations and leaves missing terrain as holes. It requires a floor reference space. It does not run the complete desktop mission UI inside the headset or certify VR comfort/performance. Actual headset tracking, controllers and frame pacing require physical hardware validation.

## Remaining external assessments

Landing footprint/vehicle certification, unresolved rock/crater hazards, bearing strength, route-wide thermal exposure, radiation, dust, suit life support, rescue capability, operational relays/ground-station access and launch/descent/ascent/rendezvous feasibility are explicitly unassessed by the route preview. They require additional vehicle and environmental data, specialist models and validation. No synthetic telemetry, arbitrary hazard map or AI-generated science replaces those inputs.

## Protected work

This feature does not regenerate prediction indexes, alter published numerical products, change benchmark scripts, or manage benchmark workers. The staging workflow verifies protected hashes before each source application. Browser verification uses a separate Vite port.


## Mission console and performance pass

The directly visible Mission strip exposes Verdict, Rank, When, Next event, Ground and Link (keyboard 1–6), plus Plan route and Return to lander. Phones show two glance chips and Mission, which expands the remaining choices in place. One detail sheet is open at a time.

Ranking uses the unchanged indexed evaluator, identical equipment, arrival and mission length at every site. Passing verdicts sort first, then normalised minimum margin, then catalogue order on exact ties. Progressive results disclose how many sites loaded; unavailable sites never silently count as failures. Repair suggestions are re-evaluated against all enabled nominal requirements and change only the exploration snapshot when previewed.

The lazy calendar covers the available mission-start coverage at four UTC starts per day, 00/06/12/18. A blank day means no passing start among those four, not proof that every hourly start fails. The glance search uses the existing next-passing search, bounded to 90 days at six-hour increments. Arrival slips assess thirteen discrete starts at 12-hour spacing over ±72 hours. These do not establish a continuous launch/landing tolerance or flight feasibility.

The timeline enumerates nominal hourly sunrise, sunset, Earthrise and Earthset boundaries, minimum battery, reserve threshold, enabled lander thermal limits/heater maximum, the limiting failure event and mission end. A timeline jump changes the scene clock; it does not move the mission departure. Ground statistics describe sampled DEM slopes/relief within 10/25/50 m at the nominal coordinate. Small zones on coarse DEMs are marked interpolated; the sampled maximum is not a bound on unresolved hazards.

Mission communications intersect hourly local Earth visibility with cached DSN complex elevations at a 6° mask. Per-station and union opportunities, longest union gap and coverage count are disclosed. Missing station geometry produces unavailable values rather than zero coverage. Bookings, hardware, interference and operational relays are unassessed.

Now (UTC) uses the app's existing real-time clock at 1× while in coverage and is labelled Predicted for now, not live telemetry. Manual clock changes leave Now mode. Source badges explain kind, product, sampling, coordinate, analysis height and validation scope. The indexed ROI4 reference ensemble's 1 m residual appears only under illumination provenance, expressly as that comparison's result, not a general uncertainty for another site or date.

Terrain/Moon pointer raycasts are bypassed during visits. Footprints sample the DEM with finite-difference normals instead of casting through the full terrain. Quality diagnostics use an external store read only by the pause-menu leaf. Compass and visor markers consume the live pose separately; the larger field HUD uses quantised pose values, memoised marker collections and narrower layout observation. Suit audio subscribes imperatively. Cached frame vectors and equipment focus candidates reduce repeated work. Shadows refresh for changed Sun direction with throttling, or material/geometry/position invalidation. Auto resolution retains at least 0.75 on desktop and 0.6 on phones and can recover after sustained inexpensive frames; long tasks are excluded from resolution decisions. Performance targets require measured hardware evidence, not an assumed development/production percentage.

The experimental VR glance shows the mission verdict, next event, mission-minimum battery, estimated link opportunity and current objective. Selecting the head-relative texture panel cycles glance, timeline and ranking summaries. Main exploration stays paused. This does not implement the entire desktop console in VR; physical optics, tracking, controllers, comfort and frame pacing remain unvalidated.

Live space weather and radiation dose, real suit consumables, abort/ascent/rendezvous windows, mapped permanently shadowed regions/ice detections, sub-resolution hazards and operational relays require additional validated data and specialist models. They are not inferred from rendered textures or AI prose.

The measured follow-up found that the existing application clock published React updates every 80 ms even in Now mode. The surface interface now publishes time text at 1 Hz in Now mode and 4 Hz during compressed playback. Its 3D clock advances continuously, but at slow rates (Now at 1×, or playback up to two simulated minutes per second) the scene redraws at 4 Hz unless something moves, because the Sun and Earth shift by far less than a pixel per frame. Dashboard/orbital timing stays at 80 ms, and direct time changes remain immediate. Numerical HUD pose updates are coalesced to at most 5 Hz with a trailing update; walking, airborne, crouch and blocked transitions still notify immediately. The compass and visor markers retain the live pose stream.

Headset readouts are scoped to the current surface visit. Entering VR before the mission console loads shows unavailable/loading values instead of a previous visit’s verdict. The glance identifies the site and distinguishes mission arrival from scene time.

## Local verification result (11 November 2026)

TypeScript and the scratch production build passed. All 39 Node verification commands and seven Python verification commands passed; the new mission-console suite has 58 checks. The Python ensemble validation ran in public-artifact mode and explicitly did not perform a new deep audit of the running per-clone jobs. Desktop and 390 px phone walkthroughs covered ranking, an alternative visit, calendar selection, event jumps, Now, source notes, keyboard/reduced motion and the custom dashboard mission round trip. No live Gemini request was made. Calculated captions are timestamped and replaced after clock jumps; notification coalescing preserves full-precision measurement inputs.

The first 1440×900 Intel UHD 630 / ANGLE D3D11 production samples (Auto/Low, 0.75 pixel ratio, Now at 1×, benchmark jobs still running) had a median of about 27 ms but p90 of about 253 ms walking and 67 ms turning.

### Stutter follow-up (11 November 2026)

Per-object probes and Chrome traces attributed the remaining long frames to three causes, now fixed:

- **Shaders linked mid-turn.** `compileAsync` traverses visible objects only, and the focus rim overlay is created on first focus. Its program linked the first time the reticle met an object: 33–65 ms, and 1.15–1.4 s while the clock ran. Warm-up now reveals hidden parts (never lights, whose count is part of every program key) for its synchronous traversal; each rim material has a hidden stand-in; and a once-a-second object count re-links parts mounted later. Repeated probes then recorded no program linked while turning, walking, clicking or opening the console.
- **HUD paint.** The full-screen helmet vignette was a 140 px blurred inset shadow. Whenever its tiles were invalidated, Chrome's GPU raster took up to 169 ms. Four edge gradients on their own layer look the same; maximum raster time in the same turning trace fell to 6 ms, and the longest GPU present from 1146 ms to 367–427 ms.
- **Continuous redraw in Now mode.** See the 4 Hz slow-clock redraw above.

Production measurements after these fixes, on the same machine with the benchmark finished, recorded as browser frame intervals at the headless 75 Hz cadence (13.3 ms per refresh):

- **Standing still:** every frame on time.
- **Walking:** median 13.5 ms, p90 40 ms, p99 54 ms; two frames over 100 ms in six seconds.
- **Turning by dragging:** median 26.6 ms.

Turning is GPU-bound. Looking toward the horizon costs about 14 ms of GPU per frame at a 0.75 pixel ratio (22 ms at 1.0), most of it the terrain mesh's far rings, which carry DEM-resolution geometry and are deliberately not simplified. That fits a 60 Hz refresh but not this headless 75 Hz one.

Occasional 200–430 ms frames remain while turning. Traces show them as the GPU process's swap-chain present blocking, with no application script, raster or WebGL work over 6 ms inside. Their count varied from 2 to 23 between identical runs on this shared integrated GPU, so they are not attributed to the app and the 33 ms p90 target is not claimed for turning.

Development builds remain slower (React's development runtime and StrictMode); development and production were measured separately rather than assuming a fixed overhead. Physical VR tracking, controllers and comfort remain untested.
