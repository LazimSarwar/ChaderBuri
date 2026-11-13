# Interactive surface experience / 1 November 2026

The surface visit now opens in the immersive browser view. Show instruments
restores the existing HUD; the solar system, planner and measured mission-site
terrain remain available.

## What the visitor can do

- Begin with a short field objective, or dismiss it and explore freely.
- Inspect a lander or concept station by clicking its visible exhibit or using
  Tools > Mission exhibit. Only an explicit catalogue site link associates a
  historical mission: currently the supported IM-1 site. Candidate sites use a
  labelled concept station. No mission terrain was added outside supported sites.
- Inspect mission payload descriptions and source links. The small model-mounted
  objects represent the first three catalogue payloads; all payloads remain in
  the inspector. Their mounting locations are illustrative.
- Deploy a solar panel or antenna. Drag the actual 3D equipment to change bearing
  and tilt/elevation, or use buttons/sliders with a keyboard or touch device.
  Compare the chosen panel in the existing 14-day planner workflow.
- Keep photographs, written observations, flags, last inspections, equipment
  settings, visited-site records, inspected exhibits and completed field-task
  records in local IndexedDB. Up to six images, eight flags and 80 record entries
  are retained across sites. Download/export remains available. Storage failure
  is shown explicitly; no account or cloud service is used. Clearing browser site
  data removes this archive. Active assignment state and walking trails are not
  resumed after reload; completed field-task records are retained.

## Scope of the visual layer

The lander models, concept station, foil finish, up to 570 bounded instanced rocks and
regolith material are educational illustrations. They do not describe surveyed
rock positions, flight hardware dimensions, historical/current vehicle attitude,
or safe traverses. Terrain elevation, DEM probes and horizon inputs remain
unchanged. A dark patch at one time is not classified as permanently shadowed.

Solar panel output uses the existing target, terrain horizon, Sun-disc/eclipse,
distance and incidence model for a 2 m2 / 28% example. Antenna output is a pointing
error and geometric Earth-centre visibility, not a verified communications link.
Walking changes the camera, not the analysis coordinate. Lamp lighting adds no
solar generation. Display-light fill is artificial. Earth and Sun positions have
not been enlarged or moved to match the supplied cinematic references.

Close surface visits use a 90 m-wide shadow region, with a bounded shadow map
instead of allocating a higher-resolution global map. The single detail texture
loads on first surface use; load failure retains procedural material. There are
no new runtime dependencies, model downloads or postprocessing packages.

## Rendering quality and presentation

- **Quality** (`auto`, `high`, `balanced`, `low`) trades pixel density, shadow-map
  size (1536/1024/512 texels), decorative soil-shader layers and the share of
  illustrative rocks drawn (100/60/32%; larger blocks always stay). `auto` starts
  from a device guess, measures sustained frame time on consecutive frames during
  a visit, steps down above 24 ms (high) or 30 ms (balanced), and steps up only
  after holding the display rate for 10 s or longer, with hysteresis. DEM geometry,
  Sun and Earth directions and every calculated value are identical at all levels.
- Rocks near the visitor use detailed meshes, farther ones a lighter version of
  the same shape; each sits in a soft illustrative contact shade. Lander pads,
  equipment feet and Chader Buri's emitter have contact shades on the rendered
  DEM facet, and the equipment mast stands on that facet.
- Walking presentation: the camera eases its look, the walk eases in and out,
  and a footstep bob, sway and landing dip are scaled by the motion setting (none
  with reduced motion). The lander, deployed equipment and Chader Buri's emitter
  are solid circles for walking; guided walks steer around them. The analysis
  coordinate, ground height and the walking physics are unchanged.
- Focus feedback is a rim glow on the object under the reticle and a thin ring on
  the ground; an activity can ask the scene to locate the lander, panel or
  antenna with a pulsing ring, slim beacon and rim glow. An optional helmet lamp
  is an illustrative display light that adds no solar generation.

## Surface polish controls

The arrival briefing also offers **Ask Chader Buri**, an optional AI exploration
companion. It can explain calculated conditions, propose mission assumptions and
offer supported site visits. Its replies and actions use the server-calculated
mission context. The connection, scientific scope and local setup are described
in [LUNA_COMPANION.md](LUNA_COMPANION.md). Without an AI connection, existing
exploration and the decision guide remain available.

- Quiet field controls collapse after four seconds of free exploration. Use
  **Field controls** to reopen them, or disable this in **Tools > Exploration
  view**. Open inspectors and focused form controls keep the full controls open.
- The centre reticle identifies nearby exhibits and deployed equipment. Click
  the hint or press **E** while the canvas is focused to inspect that object.
  The existing toolbar Inspect action remains available for terrain readings.
- Lander details include thermal seams, pressure vessels, instrument brackets,
  cable runs and instanced fasteners. Footpads and tripod feet are projected
  onto rendered terrain facets; contact shades are illustrative.
- **Astronaut view** adds optional visor edges and boots. **Gentle movement
  feedback** is separate; the footstep bob is at most about 2 cm, scaled by the
  motion setting.
  Operating-system reduced motion disables movement feedback and snaps equipment
  deployment, pointing transitions and output gauges to their final state.
  The suit is a first-person illustration layer, with depth ordering separate
  from the solar-system depth buffer; it is not a collision or hazard model.
- Equipment deploys in a short animation. The selected instrument shows a blue
  arrow indicating its chosen facing direction. Numerical output updates
  immediately; only the adjacent gauge is animated.
- Display preferences are saved locally. These presentation controls do not
  change the assessment location, mission dates, panel model or motion physics.

## Generated material asset

Built-in image generation was used for the diffuse material. The selected output
was exported as `public/textures/space/regolith-detail-v1.jpg` (1024 x 1024,
378,619 bytes). The texture is explicitly illustrative and is excluded from DEM
geometry and all scientific calculations. The original generated PNG remains in
the generator's output directory; the project consumes the JPEG in this checkout.

Final generation prompt:

> Use case: scientific-educational. Asset type: seamless tileable diffuse/albedo
> texture for a lightweight browser 3D lunar surface, not a scene or landscape
> image. Generate one square high resolution photorealistic top-down orthographic
> material scan of dry grey lunar regolith, covering roughly 2 by 2 metres. Fine
> angular powder and very small scattered angular mineral pebbles, subtle small
> shallow impact pitting and natural irregular tonal mottling. Neutral desaturated
> charcoal-to-medium grey, evenly lit diffuse albedo with absolutely no directional
> lighting, no cast shadows, no highlights, no perspective, no horizon, no sky, no
> astronauts, no equipment, no footprints, no text, no borders, no collage. All four
> edges should wrap seamlessly. Very finely detailed powder, natural rock fragments
> and micro-relief; avoid regular patterns, rings, obvious noise grain, cracks or
> large boulders. This is illustrative texture dressing, not a measured lunar data
> product. Output a single material swatch occupying the whole image.

## Graphics start-up and failure handling (11 November 2026)

A Chrome GPU report from this machine (Intel UHD 630, driver 30.0.101.1273 in the earlier hardware snapshot)
showed 13 GPU-process watchdog kills (`RESULT_CODE_HUNG`, 9–10 November) ending in "GPU process crashed too many
times with software GL", after which Chrome disabled WebGL for the session. The report records the hangs, not
which page caused them; they overlapped long stretches of heavy 3D testing on the same integrated GPU. The app was
changed to ask less of the GPU at start-up and to fail visibly and recoverably:

- **Surface assets wait for a visit.** The lander, equipment, gloves, rocks, Chader Buri's figure, dust and the
  landing sequence mount, and their shaders warm up, only once a surface visit is requested. Measured in an
  isolated headless Chrome on the same GPU, 35 s after opening the solar system: 35 → 3 shader programs,
  72 → 6 shader compiles, textures 6 → 3. Procedural texture generation (about 1.6 s of CPU when timed alone in
  Node; about 10 s in the profiled, CPU-contended development browser) and 3.7 s of main-thread waiting on shader
  links left the solar-system start-up.
- **Conservative start.** One released WebGL probe classifies the GPU: integrated GPUs start at Balanced, software
  rasterisers at Low (no multisampling). The frame-time controller adapts from there.
- **Glove and fabric textures** are generated once per page (bit-identical output, about twice as fast).
- **Failure state.** The app (not the 3D canvas) owns it, above the 3D controls, which hide meanwhile. It names the
  kind from evidence (WebGL unavailable by probe, context lost and not restored within 5 s, a file that did not
  load, or an application error), keeps the original error in a separate "Technical details" section and the
  console ("3D view failed"), and offers "Open dashboard" and, where it can help, at most two "Retry 3D in Low
  quality" attempts. The failed scene is unmounted first (no live WebGL context remains), and the retry creates
  exactly one. When WebGL is unavailable browser-wide it explains that a browser restart is needed and offers no
  retry, since no quality setting can create a context.
- `npm run verify:graphics` checks the classification, start levels, copy and wiring. A development-only switch
  (`?fail=render` or localStorage `chader-dev-fail=render`) makes the scene fail until it is rebuilt in Low quality,
  to exercise the recovery UI; an injected error tests the UI, not the original GPU hang.
