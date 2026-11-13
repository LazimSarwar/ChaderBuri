# Chader Buri

Explore lunar terrain, compare landing windows, and understand a mission's power and Earth-visibility trade-offs.

Chader Buri connects a mission-planning dashboard with an interactive 3D surface view and a conversational guide. It uses cached NASA/JPL predictions and measured lunar elevation data. It is an independent project with no NASA endorsement.

## What you can do

- Set a landing site, UTC arrival, mission duration, lander equipment and requirements.
- Use a four-step guided setup to choose an arrival, priorities and equipment, then compare the supported sites under the same assumptions.
- Compare sites or arrival dates with the same hardware, then inspect battery charge, sunlight and Earth visibility.
- Review nearby touchdown samples and observer-height sensitivity alongside the nominal result.
- Open the selected site on the surface, look around, walk, inspect terrain, use the map and try illustrative antenna and solar-panel activities.
- Ask Chader Buri to explain the displayed evidence and help navigate the workspace.
- Use suggested questions, saved browser conversations and the illustrated **How to use** guide for explanations of controls, units and result ranges.
- Read recent NASA DONKI space-weather reports with their source links and report timestamps.
- Export mission results and share a printable decision brief.

## Run locally

Use Node.js 22.12 or later and npm. Cached runtime data is included; no data regeneration is needed to start the app.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. The planning tools and surface view work without an AI-provider key.

Copy `.env.example` to the ignored `.env.local` file to configure the optional services:

- `GEMINI_API_KEY`: enables Chader Buri's Gemini conversation. `GEMINI_MODEL` can name one supported model or a comma-separated fallback list available to your Google account.
- `NASA_API_KEY`: connects the recent space-weather reports through the server's `/api/space-weather` endpoint.

Both keys stay on the server. Never give them a `VITE_` prefix or commit them to the repository. See [guide configuration](docs/LUNA_COMPANION.md).

Chat history is saved in this browser's local storage when available and can be cleared in the chat interface. Sending a question shares recent conversation and current mission context with Google Gemini. You can stop a pending question; the guide explains calculated results rather than replacing the calculation engine.

For a production build and local preview:

```bash
npm run build
npm run preview
```

The build script refreshes the runtime prediction index before type checking and bundling. Hosting conversation and space-weather services requires the supplied server endpoints or an equivalent backend. A static-only deployment can use the cached planning and exploration features.

## A simple mission journey

1. Choose the arrival time, length of stay, equipment and the limits you want to test.
2. Review the selected landing point and the condition that comes closest to a limit.
3. Compare another site or date while keeping the assumptions consistent.
4. Explore the selected site and time, then connect the surface observations to the mission-wide predictions.
5. Inspect the evidence, assumptions and assessment limits before exporting a result.

Dates are UTC. The scene clock and a mission's planned arrival can differ; use the scene-preview controls to align them.

The **How to use** page explains the settings, central decision and site list, with an annotated dashboard overview and examples of what the values mean.

## Scientific scope

The cache covers 1 September 2026 to 31 December 2028 UTC, at hourly intervals. Terrain horizons use LRO LOLA elevation products, with product resolution and observer height disclosed in the evidence.

Sun-centre visibility is different from usable solar energy. The electrical model also considers exposed solar-disc fraction, distance, panel pointing, efficiency, load, storage and conversion losses. Earth visibility and modeled ground-station opportunities do not establish an operational radio link or reserve network capacity.

Results are preliminary screening predictions. They do not certify landing safety or mission success. Terrain hazards, equipment qualification and unassessed conditions remain separate work. Hourly samples can miss short transitions; nearby sample counts are not success probabilities. The published-region illumination comparison has an unresolved residual and does not establish global accuracy.

Surface colour, small rocks, equipment, movement and the landing animation are illustrative. The terrain relief is measured; the scene is not live lunar imagery or spacecraft telemetry.

DONKI adds recent solar-flare, eruption, energetic-particle and notice reports. Their current Earth-based report timestamps are separate from the simulated mission date. Reports provide context, not lunar-site radiation-dose estimates; they do not change the mission verdict or site ranking. Unavailable and stale feeds remain labelled.

- [Model equations, sources and limitations](docs/SCIENCE.md)
- [Regional benchmark audit](docs/BENCHMARK_AUDIT.md)
- [Verification and reproducibility](docs/VERIFICATION.md)
- [Surface experience](docs/SURFACE_EXPERIENCE.md)
- [Exploration fieldwork](docs/EXPLORATION_FIELDWORK.md)

The `verify:*` package scripts check individual parts of the model and interface. Data-generation scripts are separate from normal app startup.

## Data and visual credits

| Resource | Role |
|---|---|
| [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | DE441 Sun/Earth predictions and solar-system geometry |
| [NASA LRO / LOLA, PDS Geosciences](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) | Lunar elevations and terrain horizons |
| [NASA/JPL NAIF SPICE](https://naif.jpl.nasa.gov/naif/) | Body orientations, radii and gravitational parameters |
| [NASA Deep Space Network references](https://deepspace.jpl.nasa.gov/dsndocs/810-005/) | Communications screening assumptions |
| [NASA CCMC DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) | Recent space-weather reports and notices |
| [NASA CLPS](https://www.nasa.gov/clps/) and [LROC](https://lroc.sese.asu.edu/) | Mission records and landing-coordinate context |
| [Barker and colleagues / NASA GSFC PGDA](https://pgda.gsfc.nasa.gov/products/78) | Regional illumination and terrain reference |
| [NASA Image and Video Library](https://images.nasa.gov/) | Selected archived images |
| [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | Selected planetary and moon appearance maps |
| [NASA Earth imagery via three.js](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets) | Earth and cloud maps |
| [Solar System Scope / INOVE](https://www.solarsystemscope.com/textures/) | Appearance maps under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Solar System Scope maps cover the Moon, Mercury, Venus clouds, Jupiter, Saturn and its rings, Uranus and the Sun. The Sun map is downscaled for delivery. Appearance maps are historical composites with authored colour and gap fills. The star backdrop is procedural rather than a measured star catalogue.

[Scene provenance](public/data/space/manifest.json), [texture sources and fingerprints](public/data/space/assets.json), and [terrain provenance](public/data/terrain/manifest.json) record the supplied products. Further scientific references are documented in the model notes.

## License

First-party project code is licensed under the [MIT License](LICENSE), copyright 2026 Tanjil Sarwar Lazim. Third-party code, scientific data, images and textures retain their own terms and attribution, including Solar System Scope / INOVE CC BY 4.0. The [previous Apache License text](licenses/Apache-2.0-original.txt) is preserved separately.
