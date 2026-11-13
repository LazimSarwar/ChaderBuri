# Chader Buri exploration guide

The opening visit introduces Chader Buri using the white-saree figure from the project's resource folder. The portrait reopens help anywhere in the workspace. The introductory surface walk works without a provider key. Visitors choose the Sun or Earth, turn toward its predicted bearing, and read what is visible from the selected site and time. They can open the instruments or take over the surface controls. Every launch begins on black. The figure appears, she introduces herself in timed text lines, and Start begins a camera descent to the selected lunar site after the final line. Her written guidance continues through arrival and the Sun/Earth choices. Visitors can leave the tour for free exploration. Links to a named tool or saved journey open their requested destination.

## Gemini conversation

Set GEMINI_API_KEY in the project's ignored .env.local or the deployment's server secrets. GEMINI_MODEL is one model or a comma-separated list tried in order; it defaults to gemini-3.6-flash, then gemini-3.5-flash, then gemini-3.1-flash-lite. Google no longer offers gemini-2.5-flash to new API keys, and the newest Flash models can time out under heavy demand, so a model that is retired (404), overloaded (503), rate limited (429) or silent past its share of the 30 s budget hands over to the next one. Key or billing refusals are not retried. Run npm run dev, or npm run build followed by npm run preview. Both local servers mount /api/companion. The serverless entry is api/companion.ts and requires the public/data catalog, prediction index, ephemerides, horizons and dispersion products. A static-only deployment can run the guided walk.

Sending a question shares recent conversation, the current workspace and search, selected site, scene hour, guide mission assumptions and calculated mission evidence with Google Gemini. Browser read-aloud and dictation depend on device support. Dictation starts on click and puts the transcript in the composer for review. Browser speech services may process audio.

Gemini may open workspace tools including the landing calendar, energy instruments and landing-window comparison, filter the site or mission catalog, start the surface walk, visit a requested site, turn the camera or shift the timeline. Each action is validated before use. Better-site recommendations use the independently calculated candidate list. Proposed mission assumption changes require application and recalculation. The guide's mission assumptions and a planner scenario can differ. Closing the guide cancels a pending conversation request. Unassessed data stays explicit.

Run npm run verify:lunar-companion for the evidence, action validation, HTTP and mocked Gemini transport tests. Use a configured Gemini key to test live model access.

## Living guide (8 November 2026)

- **More things she can do on request.** Besides dashboards, search, site visits
  and facing the Sun, Earth or skyline, she can play or pause time, close the open
  dashboard, switch Explain mode, and, while you stand on the surface, take a
  journal photograph, make you jump or plant a survey flag. Every operation is
  checked against `guideDestinations` on the server and again in the browser; an
  invented operation is rejected and nothing happens.
- **Human conversation.** The persona prompt asks for a warm grandmother's spoken
  style and varied openings. The app's screens are English only, but she answers
  in the language the visitor writes in (English when unclear), keeping numbers,
  units, UTC times, site names and option labels exactly as on screen. She can
  mention her spinning wheel from the folk tale, but gives the real science when
  the Moon's features come up.
- **She notices what you do.** Without any AI call, she makes one short remark for
  a first jump, bootprints, walking milestones, a photograph, a survey flag,
  Earth crossing the skyline and the Sun disc leaving or returning. Each remark is
  said once, at most every 20 seconds, never over an open field card. Lines are in
  `src/lib/buriReactions.ts`; `npm run verify:buri-reactions` checks the rules.
- **Chader Buri speaks in text by default.** Her greeting, tour lines, chat replies and
  comments appear as captions. In the field view, "Read captions aloud" (off by
  default; pause menu or her caption menu) reads captions with the browser's
  `speechSynthesis`; each caption has replay, mute, dismiss and stop-speech controls.
  There is no radio tone. The recorded files in public/voice and
  public/chader-buri-welcome.mp3 are no longer used.
- **Suit sounds.** Procedural Web Audio (no files): breathing, bootfalls conducted
  through the suit and landing thuds scaled by fall speed. There is no air, so
  nothing outside is heard.
- **Lunar dust.** Bootsteps and landings throw regolith clumps that follow clean
  ballistic arcs under 1.62 m/s² with no drag, as in Apollo footage. Clump sizes
  are enlarged for visibility. Disabled with reduced motion.
- Tools > Exploration view has switches for suit sounds and her comments. The
  astronaut view (visor edges and boots) now starts on.

## Mission Visor, landing simulation and Chader Buri everywhere (8 November 2026)

- **Action policy.** Clear requests run at once (`action`). Her own ideas arrive as
  `suggestion` and show an Allow / Not now card; Allow re-checks that the view is unchanged
  and the operation still applies. Dismissed suggestions are remembered for the session and
  sent with each question so she does not repeat them. Invalid suggestions are dropped while
  her explanation is kept. Explanations change nothing.
- **Screen awareness.** The visor, Site conditions and Mission decision publish the readouts
  they show (`src/lib/screenDigest.ts`); the open screen's readouts travel with each question,
  so "why is this number red?" resolves to the real readout and its source.
- **Ask Chader Buri** in every dashboard header and on every visor readout sends one seeded
  question (once per press, even if the chat reopens).
- **Mission Visor** (`src/MissionVisor.tsx`, data in `src/lib/visorData.ts`): Power system,
  Earth link (an estimated link opportunity, never an operational DSN pass), Environment and
  Mission clock. Every value shows its unit, kind (measured / calculated / estimated /
  illustrative), source and assumption. Groups can be hidden; `V` toggles the visor;
  Mission Control and Back to surface move between exploration and dashboards.
- **Landing simulation** (`src/lib/landingProfile.ts`, `src/space/LandingSequence.tsx`):
  time-compressed and illustrative, not flight telemetry. One canonical lander transform
  (`runtime.lander`) drives the existing exhibit, so the lander that lands is the one that
  stays; legs blend onto the measured ground after contact. Plume-surface dust and the
  touchdown burst are ballistic under 1.62 m/s². Skip anytime; off with reduced motion or the
  Watch landings preference.
- **Chader Buri on the surface** (`src/space/BuriFigure.tsx`): a camera-facing cut-out of her
  artwork beside the lander, driven by `src/lib/characterController.ts` (idle / listening /
  talking / pointing). A rigged GLB can later use the same controller.
- **NASA imagery** (`src/lib/nasaImagery.ts`): verified images.nasa.gov IDs in the site Details
  card, labelled when they are regional rather than site views.
- Tests: `verify:buri-reactions`, `verify:visor`, `verify:landing-sequence`.
