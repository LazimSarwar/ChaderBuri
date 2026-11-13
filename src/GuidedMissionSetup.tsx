import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, HelpCircle, X } from 'lucide-react'
import type { Ephemeris, Horizon, Site } from './data'
import type { MissionState } from './lib/guideBriefs'
import { siteSeries } from './lib/seriesCache'
import { useScreenDigest } from './lib/screenDigest'
import type { ScreenDigestItem } from './lib/contracts'
import { assessIntake, initialIntake, INTAKE_PURPOSES, INTAKE_STORAGE, intakeCoverageHours, intakeDateInput, intakeDateLabel, intakeLimitingReason, intakeMarginExplanation, intakeMissionForGuide, intakeRankingTie, readIntakeDraft, validateIntake, type IntakeDraft, type IntakePurpose } from './lib/missionIntake'
import { nextSetupStep } from './lib/setupNavigation'
import './guided-mission.css'

type Props = {
  sites: Site[]
  eph: Record<string, Record<'sun' | 'earth', Ephemeris>>
  horizons: Record<string, Horizon>
  startMs: number
  totalHours: number
  totalSiteCount?: number
  initialRow?: number
  /** Render as a dashboard page; its surrounding workspace owns navigation and focus. */
  embedded?: boolean
  onApply: (mission: MissionState) => void
  /** Current draft for AI explanations only; invalid input publishes null. Never applies a plan. */
  onDraft?: (mission: MissionState | null) => void
  onClose: () => void
  onAsk?: (question: string) => void
}
const STEP_TITLES = ['When would you like to arrive?', 'What matters most to you?', 'What will your lander use?', 'Here’s how the sites compare.']
type NumberKey = Exclude<keyof IntakeDraft, 'landingUTC' | 'purpose' | 'equipment'>
const draftNumber = (n: number) => Number.isFinite(n) ? String(n) : 'Not entered'
function radioKeys(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role=radio]')]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
  e.preventDefault(); buttons[next]?.focus(); buttons[next]?.click()
}

/** A small, deterministic mission interview. It never edits the plan before Apply. */
export function GuidedMissionSetup(p: Props) {
  const coverageHours = useMemo(() => intakeCoverageHours(p.totalHours, p.sites.flatMap(s => p.eph[s.slug] ? [p.eph[s.slug].sun.rows.length, p.eph[s.slug].earth.rows.length] : [])), [p.totalHours, p.sites, p.eph])
  const [draft, setDraft] = useState<IntakeDraft>(() => {
    try { const saved = readIntakeDraft(localStorage.getItem(INTAKE_STORAGE)); if (saved) return saved } catch { /* storage is optional */ }
    return initialIntake(p.startMs, coverageHours, p.initialRow)
  })
  const [step, setStep] = useState(0), [errors, setErrors] = useState<string[]>([])
  const [errorFields, setErrorFields] = useState<string[]>([])
  const errorId = useId()
  const panel = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null)
  const onClose = useRef(p.onClose); onClose.current = p.onClose
  const previousFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (p.embedded) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose.current(); return }
      if (e.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,summary,[tabindex="0"]')].filter(el => el.getClientRects().length > 0)
      const first = focusable[0], last = focusable.at(-1)
      if (e.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }) }
  }, [p.embedded])
  useEffect(() => { heading.current?.focus({ preventScroll: true }); panel.current?.querySelector('.mission-setup-body')?.scrollTo(0, 0) }, [step])
  useEffect(() => {
    if (!errors.length) return
    const fields = [...panel.current?.querySelectorAll<HTMLInputElement>('.mission-setup-body input') ?? []]
    const invalid = fields.find(field => !field.validity.valid)
    if (invalid) {
      // A requirements field can be inside a closed disclosure. Reveal it before moving focus.
      for (let node = invalid.parentElement; node && node !== panel.current; node = node.parentElement) if (node instanceof HTMLDetailsElement) node.open = true
      invalid.focus({ preventScroll: true }); invalid.scrollIntoView({ block: 'nearest' })
    } else panel.current?.querySelector<HTMLElement>('.mission-setup-error')?.focus()
  }, [errors, step])
  useEffect(() => { try { localStorage.setItem(INTAKE_STORAGE, JSON.stringify({ v: 1, draft })) } catch { /* private browsing / quota: keep this visit usable */ } }, [draft])
  const update = <K extends keyof IntakeDraft>(key: K, value: IntakeDraft[K]) => { setDraft(d => ({ ...d, [key]: value })); setErrors([]); setErrorFields([]) }
  const validation = useMemo(() => validateIntake(draft, p.startMs, coverageHours), [draft, p.startMs, coverageHours])
  const series = useMemo(() => p.sites.flatMap(s => {
    if (!p.eph[s.slug] || !p.horizons[s.slug]) return []
    try { return [siteSeries(s.slug, p.eph[s.slug].sun, p.eph[s.slug].earth, p.horizons[s.slug])] } catch { return [] }
  }), [p.sites, p.eph, p.horizons])
  const assessment = useMemo(() => step === 3 && validation.ok ? assessIntake(series, validation.mission) : null, [step, validation, series])
  useEffect(() => {
    if (step === 3 && !validation.ok) { setStep(0); setErrors(validation.errors); setErrorFields([]) }
  }, [step, validation])
  const names = useMemo(() => new Map(p.sites.map(s => [s.slug, s.name])), [p.sites])
  const next = () => {
    const fields = [...panel.current?.querySelectorAll<HTMLInputElement>('.mission-setup-body input') ?? []]
    const invalid = fields.filter(field => !field.validity.valid).map(field => ({ name: field.name, message: `${field.closest('label')?.querySelector('span')?.textContent ?? 'Entry'}: ${field.validationMessage}` }))
    const result = nextSetupStep(step, invalid, validation)
    setErrors(result.errors); setErrorFields(result.fields); setStep(result.step)
  }
  const purpose = (key: IntakePurpose) => { setDraft(d => ({ ...d, purpose: key, ...INTAKE_PURPOSES[key].limits })); setErrors([]); setErrorFields([]) }
  const numberField = (key: NumberKey, label: string, min: number, max: number, note: string, fieldStep: number | 'any' = 'any') => <label className="mission-setup-field"><span>{label}</span><input type="number" name={key} min={min} max={max} step={fieldStep} required aria-invalid={errorFields.includes(key) || undefined} aria-describedby={errorFields.includes(key) ? errorId : undefined} value={Number.isFinite(draft[key]) ? draft[key] : ''} onChange={e => update(key, e.currentTarget.valueAsNumber)} /><small>{note}</small></label>
  const total = p.totalSiteCount ?? p.sites.length
  const coverageEnd = p.startMs + coverageHours * 3_600_000
  const durationForBound = Number.isFinite(draft.missionDays) ? draft.missionDays : 3
  const chosen = assessment?.ranked[0]
  const rankingTies = assessment ? intakeRankingTie(assessment.ranked) : 0
  const marginExplanation = chosen && validation.ok ? intakeMarginExplanation(chosen.result, validation.mission.c) : null
  const firstSlug = p.sites[0]?.slug
  const draftMission = useMemo(() => intakeMissionForGuide(validation, chosen?.slug ?? firstSlug), [validation, chosen?.slug, firstSlug])
  const draftObserver = useRef(p.onDraft); draftObserver.current = p.onDraft
  useEffect(() => { draftObserver.current?.(draftMission) }, [draftMission])
  useEffect(() => () => { draftObserver.current?.(null) }, [])
  const digest: ScreenDigestItem[] = [
    { id: 'setup-scope', label: 'Mission setup scope', value: 'Draft only. Nothing has been applied to the dashboard yet.', source: 'Visitor entries' },
    { id: 'setup-stage', label: 'Current setup step', value: `${step + 1} of 4: ${STEP_TITLES[step]}` },
    { id: 'setup-validation', label: 'Draft input validation', value: validation.ok ? 'Inputs fit the prediction coverage. Draft is not applied.' : 'Input needs correction; no mission result should be inferred.', status: validation.ok ? 'ok' : 'warn' },
    ...(!validation.ok ? validation.errors.slice(0, 3).map((error, i) => ({ id: `setup-error-${i}`, label: 'Draft entry to correct', value: error, status: 'warn' as const, source: 'Input validation' })) : []),
    { id: 'setup-arrival', label: 'Draft arrival', value: `${draft.landingUTC.replace('T', ' ')} UTC` },
    { id: 'setup-duration', label: 'Draft mission length', value: draftNumber(draft.missionDays), unit: 'days' },
    { id: 'setup-purpose', label: 'Draft priority', value: INTAKE_PURPOSES[draft.purpose].label },
    { id: 'setup-lit', label: 'Draft minimum sunlight', value: draftNumber(draft.minLitPct), unit: '%' },
    { id: 'setup-dark', label: 'Draft longest darkness limit', value: draftNumber(draft.maxDarkH), unit: 'h' },
    { id: 'setup-earth', label: 'Draft minimum Earth visibility', value: draftNumber(draft.minLinkPct), unit: '%' },
    { id: 'setup-gap', label: 'Draft longest Earth gap limit', value: draftNumber(draft.maxGapH), unit: 'h' },
    { id: 'setup-hardware', label: 'Draft lander', value: draft.equipment === 'example' ? 'Illustrative example lander' : 'Custom assumptions; ideal tracking' },
    { id: 'setup-panel', label: 'Draft panel area', value: draftNumber(draft.equipment === 'example' ? 2 : draft.panelAreaM2), unit: 'm²' },
    { id: 'setup-load', label: 'Draft constant demand', value: draftNumber(draft.equipment === 'example' ? 100 : draft.loadW), unit: 'W' },
    { id: 'setup-storage', label: 'Draft battery storage', value: draftNumber(draft.equipment === 'example' ? 10 : draft.capacityKWh), unit: 'kWh' },
    { id: 'setup-reserve', label: 'Draft battery reserve', value: draftNumber(draft.equipment === 'example' ? 20 : draft.reservePct), unit: '%' },
    { id: 'setup-limits', label: 'What this setup assesses', value: 'Hourly visibility and battery; excludes landing hazards, radio and thermal.' },
    ...(assessment ? [{ id: 'setup-count', label: 'Sites assessed', value: `${assessment.ranked.length} of ${total}; ${assessment.passing} meet every requirement` }] : []),
    ...(rankingTies > 1 ? [{ id: 'setup-ranking-tie', label: 'Recommendation tie', value: `${rankingTies} sites share the top margin; no uniquely better landing is established.` }] : []),
    ...(chosen ? [
      { id: 'setup-best', label: chosen.result.pass ? 'Best assessed match' : 'Closest assessed option (misses requirements)', value: names.get(chosen.slug) ?? chosen.slug },
      { id: 'setup-verdict', label: 'Draft result', value: chosen.result.pass ? 'Meets selected requirements' : 'Misses selected requirements', status: chosen.result.pass ? 'ok' as const : 'fail' as const },
      { id: 'setup-result-lit', label: 'Draft result sunlight', value: chosen.result.litPct.toFixed(1), unit: '%' },
      { id: 'setup-result-earth', label: 'Draft result Earth in view', value: chosen.result.linkPct.toFixed(1), unit: '%' },
      { id: 'setup-result-battery', label: 'Draft result lowest battery', value: chosen.result.power?.minPct.toFixed(1) ?? 'Not assessed', unit: '%' },
      { id: 'setup-result-dark', label: 'Draft result longest darkness', value: String(chosen.result.longestDarkH), unit: 'h' },
      { id: 'setup-result-gap', label: 'Draft result longest Earth gap', value: String(chosen.result.longestGapH), unit: 'h' },
    ] : []),
  ]
  useScreenDigest('setup', digest, JSON.stringify(digest))
  const apply = () => {
    if (!chosen || !validation.ok) return
    p.onApply({ slug: chosen.slug, row: validation.mission.row, c: { ...validation.mission.c, power: validation.mission.c.power ? { ...validation.mission.c.power } : undefined } })
  }
  const back = () => { setErrors([]); setErrorFields([]); if (step === 0) p.onClose(); else setStep(s => s - 1) }
  return <div className="mission-setup" data-embedded={p.embedded || undefined} onPointerDown={e => e.stopPropagation()}>
    <section ref={panel} className="mission-setup-dialog" role={p.embedded ? 'region' : 'dialog'} aria-modal={p.embedded ? undefined : true} aria-labelledby="mission-setup-heading" onKeyDown={e => { if (!p.embedded) e.stopPropagation() }}>
      <header className="mission-setup-header"><span>Plan with Chader Buri<small>Step {step + 1} of 4</small></span><button type="button" aria-label="Close guided mission setup" onClick={p.onClose}><X size={20} /></button></header>
      <div className="mission-setup-body">
        <h2 ref={heading} id="mission-setup-heading" tabIndex={-1}>{STEP_TITLES[step]}</h2>
        {errors.length > 0 && <div id={errorId} className="mission-setup-error" role="alert" tabIndex={-1}><strong>Let’s check these entries.</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        {step === 0 && <>
          <p>Choose a simulated landing time and length of stay. We’ll check the same mission at every available site.</p>
          <label className="mission-setup-field"><span>Arrival date and hour (UTC)</span><input type="datetime-local" name="landingUTC" required step={3600} min={intakeDateInput(p.startMs)} max={intakeDateInput(coverageEnd - durationForBound * 24 * 3_600_000)} aria-invalid={errorFields.includes('landingUTC') || undefined} aria-describedby={errorFields.includes('landingUTC') ? errorId : undefined} value={draft.landingUTC} onChange={e => update('landingUTC', e.target.value)} /><small>UTC is one shared clock worldwide. This field is UTC, even if your device uses a different time zone.</small></label>
          {numberField('missionDays', 'How many days will you stay?', 3, 30, 'Choose 3–30 whole days. A longer stay may include more darkness.', 1)}
          <p className="mission-setup-note">Prediction coverage: {intakeDateLabel(p.startMs)} to {intakeDateLabel(coverageEnd)}. Your whole stay must fit.</p>
        </>}
        {step === 1 && <>
          <p>Pick a starting point. The numbers below are example requirements you can change, not NASA limits.</p>
          <div className="mission-setup-choices" role="radiogroup" aria-label="Purpose of your mission" onKeyDown={radioKeys}>{(Object.entries(INTAKE_PURPOSES) as [IntakePurpose, typeof INTAKE_PURPOSES.balanced][]).map(([key, option]) => <button type="button" role="radio" aria-checked={draft.purpose === key} tabIndex={draft.purpose === key ? 0 : -1} key={key} onClick={() => purpose(key)}><span className="mission-setup-radio" aria-hidden="true">{draft.purpose === key && <Check size={14} />}</span><span><strong>{option.label}</strong><small>{option.description}</small></span></button>)}</div>
          <p className="mission-setup-limits">At least <strong>{draft.minLitPct}% sunlight</strong> and <strong>{draft.minLinkPct}% Earth visibility</strong>. At most <strong>{draft.maxDarkH} h darkness</strong> or <strong>{draft.maxGapH} h without Earth</strong> at a time.</p>
          <details className="mission-setup-details"><summary>Adjust these four requirements</summary><div className="mission-setup-fields">
            {numberField('minLitPct', 'Minimum sunlight (%)', 0, 100, 'Share of mission hours with the Sun’s centre above the measured skyline.')}
            {numberField('maxDarkH', 'Longest darkness (h)', 0, 400, '0–400 h. The longest continuous stretch without the Sun’s centre in view.')}
            {numberField('minLinkPct', 'Minimum Earth visibility (%)', 0, 100, 'Earth above the skyline. A radio link also needs suitable equipment and a ground station.')}
            {numberField('maxGapH', 'Longest Earth gap (h)', 0, 400, '0–400 h. How long Earth may be hidden continuously within this mission.')}
          </div></details>
        </>}
        {step === 2 && <>
          <p>Sunlight alone does not tell us whether the battery lasts. We also need power demand, panel area and storage.</p>
          <div className="mission-setup-choices" role="radiogroup" aria-label="Lander assumptions" onKeyDown={radioKeys}>
            <button type="button" role="radio" aria-checked={draft.equipment === 'example'} tabIndex={draft.equipment === 'example' ? 0 : -1} onClick={() => update('equipment', 'example')}><span className="mission-setup-radio" aria-hidden="true">{draft.equipment === 'example' && <Check size={14} />}</span><span><strong>Use the example lander</strong><small>2 m² tracking panel, 100 W demand, 10 kWh battery and 20% reserve. An illustration, not a flown vehicle.</small></span></button>
            <button type="button" role="radio" aria-checked={draft.equipment === 'custom'} tabIndex={draft.equipment === 'custom' ? 0 : -1} onClick={() => update('equipment', 'custom')}><span className="mission-setup-radio" aria-hidden="true">{draft.equipment === 'custom' && <Check size={14} />}</span><span><strong>Enter my own assumptions</strong><small>Use values for a lander you want to compare.</small></span></button>
          </div>
          {draft.equipment === 'custom' && <div className="mission-setup-fields">
            {numberField('panelAreaM2', 'Solar panel area (m²)', 0.1, 100, '0.1–100 m². Larger panels can collect more energy.')}
            {numberField('loadW', 'Constant power demand (W)', 0, 10000, '0–10,000 W. This is how much the lander uses continuously.')}
            {numberField('capacityKWh', 'Battery storage (kWh)', 0.1, 200, '0.1–200 kWh. Stored energy for low-light periods.')}
            {numberField('reservePct', 'Minimum battery reserve (%)', 0, 90, '0–90%. The minimum remaining charge you want to keep.')}
          </div>}
          <details className="mission-setup-details"><summary>Other assumptions in this comparison</summary><p>Ideal Sun tracking; 28% panel efficiency; 90% starting battery charge; 95% charge and discharge efficiencies. Heater demand, temperature, terrain hazards and radio performance are not assessed in this setup. Advanced settings remain available in the dashboard.</p></details>
        </>}
        {step === 3 && validation.ok && assessment && <>
          <p><strong>{intakeDateLabel(p.startMs + validation.mission.row * 3_600_000)}</strong> for <strong>{draft.missionDays} days</strong>. {INTAKE_PURPOSES[draft.purpose].label}.</p>
          <div className="mission-setup-review"><span>Sunlight ≥ {draft.minLitPct}%</span><span>Darkness ≤ {draft.maxDarkH} h</span><span>Earth in view ≥ {draft.minLinkPct}%</span><span>Earth gap ≤ {draft.maxGapH} h</span><span>{validation.mission.c.power!.panelAreaM2} m² panel</span><span>{validation.mission.c.power!.loadW} W demand</span><span>{validation.mission.c.power!.capacityWh / 1000} kWh battery</span><span>{validation.mission.c.power!.reservePct}% reserve</span></div>
          <p className="mission-setup-note">Assessed {assessment.ranked.length} of {total} catalogued sites at this exact arrival hour. {assessment.passing} meet every selected requirement.{assessment.ranked.length < total && ' Sites still loading or without full coverage are excluded; this recommendation may change as more data becomes available.'}</p>
          {chosen ? <>
            <h3>{chosen.result.pass ? 'Best match among the assessed sites' : 'No assessed site meets every requirement'}</h3>
            {rankingTies > 1 && <p className="mission-setup-note">Several sites share the same ranking margin. Their order does not identify a uniquely better landing site.</p>}
            {marginExplanation && <p>{marginExplanation}</p>}
            {!chosen.result.pass && <p>These are the closest options, not recommended landings. Go back to change your date, duration or lander, or inspect the closest result in the dashboard.</p>}
            <ol className="mission-setup-results">{assessment.ranked.slice(0, 3).map((item, i) => <li key={item.slug}><div className="mission-setup-result-head"><strong>{i + 1}. {names.get(item.slug) ?? item.slug}</strong><span data-pass={item.result.pass}>{item.result.pass ? 'Meets your requirements' : 'Misses your requirements'}</span></div><p>{intakeLimitingReason(item.result, validation.mission.c)}</p><dl><div><dt>Sunlight</dt><dd>{item.result.litPct.toFixed(1)}%</dd></div><div><dt>Earth in view</dt><dd>{item.result.linkPct.toFixed(1)}%</dd></div><div><dt>Lowest battery</dt><dd>{item.result.power?.minPct.toFixed(1) ?? '—'}%</dd></div></dl><details><summary>Darkness and Earth gaps</summary><p>Longest darkness: {item.result.longestDarkH} h. Longest time without Earth: {item.result.longestGapH} h.</p></details></li>)}</ol>
            <p className="mission-setup-note">The order matches the dashboard: passing results first, then the largest margin on the tightest requirement. This compares the modelled landing points; terrain hazards, a guaranteed radio link and landing clearance need separate assessment.</p>
          </> : <p role="status">No site has the complete data needed for this stay yet. Wait for loading, choose another date, or return to the dashboard.</p>}
          <p>Review this result with the same dates and equipment, compare another option, then explore the selected site.</p>
        </>}
        {p.onAsk && step < 3 && <button type="button" className="mission-setup-ask" onClick={() => p.onAsk?.(step === 0 ? 'Explain how arrival date and mission duration affect a lunar landing comparison in simple words.' : step === 1 ? 'Explain sunlight, Earth visibility and the longest gaps in simple words.' : 'Explain panel area, power demand, battery storage and reserve in simple words.')}><HelpCircle size={16} />Explain these terms with Chader Buri</button>}
      </div>
      <footer className="mission-setup-footer"><button type="button" className="mission-setup-secondary" onClick={back}><ArrowLeft size={16} />{step === 0 ? 'Not now' : 'Back'}</button>{step < 3 ? <button type="button" className="mission-setup-primary" onClick={next}>{step === 2 ? 'Compare sites' : 'Continue'}<ArrowRight size={16} /></button> : <button type="button" className="mission-setup-primary" disabled={!chosen || !validation.ok} onClick={apply}>{chosen?.result.pass ? 'Review this result' : 'Review closest result'}<ArrowRight size={16} /></button>}</footer>
    </section>
  </div>
}
