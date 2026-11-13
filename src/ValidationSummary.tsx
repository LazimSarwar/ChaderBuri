import type { MouseEvent } from 'react'
import type { BenchmarkState } from './BenchmarkPanel'
import type { PredictionIndex } from './lib/predictionIndex'
import { MATCHED_COMPARISON_ID, regionalValidationSummary } from './lib/validationSummary'
import './validation-summary.css'

export function ValidationSummary({ state, index, onValidation }: { state: BenchmarkState; index: PredictionIndex; onValidation: () => void }) {
  const regional = state.reports ? regionalValidationSummary(state.reports) : null
  const revealMatchedComparison = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = document.getElementById(MATCHED_COMPARISON_ID)
    if (!target) return
    // Reveal the matching model before following the native fragment link. This also
    // works when the disclosure was closed again or the link is activated with Enter.
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true
    }
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'start', behavior: 'auto' })
  }
  return <section className="validation-summary" aria-labelledby="validation-summary-heading">
    <h3 id="validation-summary-heading">How much has been checked?</h3>
    <p>A mission result checks your chosen requirements. The evidence below explains how far those predictions have been tested.</p>
    <dl>
      <div><dt>Source integrity <span>Checked on load</span></dt><dd>Loaded indexed products are checked against their SHA-256 fingerprints. This checks consistent inputs, not physical accuracy.<small>Dataset {index.datasetId.slice(0, 12)} · model {index.model.version} · predictions {index.coverage.start} to {index.coverage.stop} UTC</small></dd></div>
      <div><dt>Published illumination <span data-status="unresolved">{regional ? regional.status : state.error ? 'Unavailable' : 'Loading evidence'}</span></dt><dd>
        {regional ? <><strong>{regional.cloneCount} terrain clones compared with Barker et al.</strong><span className="validation-differences">At 1 m: {regional.oneM}<br />At 5 m: {regional.fiveM}</span><small>These differences are our estimate minus the published reference. A + means our estimate is higher; this is not an accuracy score.</small><small>{regional.scope} No numerical acceptance threshold or global accuracy bound is established.</small><a href={`#${MATCHED_COMPARISON_ID}`} onClick={revealMatchedComparison}>See this matched-model comparison and its limits</a></>
          : state.error ? <div role="alert">The verified comparison products could not be loaded. No accuracy result is shown.<small>{state.error}</small><button type="button" className="dash-btn" onClick={state.retry}>Retry validation evidence</button></div>
            : <span role="status">Loading the existing fingerprinted reports…</span>}
      </dd></div>
      <div><dt>Battery &amp; thermal models <span>Internal checks</span></dt><dd>Analytic cases and consistency checks test the implementation. They do not independently validate an actual lander’s electrical or thermal performance.<button type="button" onClick={onValidation}>Inspect consistency checks</button></dd></div>
      <div><dt>Event timing <span>Approximate</span></dt><dd>Mission energy and durations use hourly samples. Displayed rise/set times interpolate those directions; short events can be missed. No numerical timing uncertainty bound is established.</dd></div>
      <div><dt>Operational readiness <span>Not established</span></dt><dd>Landing hazards, crew life support and radiation are not assessed. Radio estimates do not establish a working link or a booked DSN pass. These results are screening estimates.</dd></div>
    </dl>
  </section>
}
