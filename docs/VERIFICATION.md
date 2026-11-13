# Verification

The repository includes deterministic model checks, interface contract checks
and published data provenance. Verification commands are listed in
`package.json`; their implementation is in `scripts/verify_*.ts` and
`scripts/verify_*.py`.

## Install and type-check

Use Node.js 22.12 or later and install the locked dependencies:

```bash
npm ci
npx tsc --noEmit
```

## Model and data checks

```bash
npm run verify:space
npm run verify:architect
npm run verify:power
npm run verify:thermal
npm run verify:dsn
npm run verify:evidence
npm run verify:validation
npm run verify:site-products
```

These cover the cached geometry, electrical assumptions, model boundaries,
station opportunities and provenance. Checks against another output from the
same source are consistency checks, not independent validation.

## Mission and interface checks

```bash
npm run verify:mission-journey
npm run verify:comparison
npm run verify:dashboard
npm run verify:lunar-companion
npm run verify:field
npm run verify:mission-console
npm run verify:excursion
npm run verify:loading
```

These exercise planning contracts, saved mission state, comparison behavior,
assistant context, surface activities, shared time and recovery states. They
complement browser testing rather than replace it.

## Browser review

Start the app with `npm run dev`. Check a fresh visit on desktop and phone:

1. Welcome, Start, solar system and selection of a lunar site.
2. Mission setup, displayed assumptions and site/date comparison.
3. The 7-day date example with identical equipment and requirements.
4. Opening the selected mission on the surface; map, antenna and panel controls.
5. Assistant explanations after a mission, time or site change; cancellation and
   browser chat-history controls.
6. Validation, CSV downloads and printable briefs.
7. Space-weather report timestamps separately from the simulated mission date.

Also check keyboard operation, reduced motion, landscape layout, slow loading
and unavailable service states. A browser emulator does not establish physical
phone performance or headset compatibility. Physical-device and headset testing
remain separate checks.

## External validation and limits

The [benchmark audit](BENCHMARK_AUDIT.md) describes the comparison with published
regional illumination results and its remaining discrepancies. This regional
comparison is not a global accuracy percentage, uncertainty bound or landing
safety assessment.

The [science documentation](SCIENCE.md) defines sampling, terrain resolution,
observer assumptions, electrical/thermal scope and communications limitations.
Passing chosen requirements does not establish landing safety, operational DSN
availability or mission success.

Data generation commands are separate from verification. They can require large
source downloads, Python dependencies and substantial processing. Keep existing
data-generation jobs and their checkpoints intact when reviewing the included
published products.

Terrain-source checks such as `verify:terrain-lod` also require the original
LOLA source archive in `data/dem`. These source caches are ignored by Git and
are not needed to run the application using its included published products.
