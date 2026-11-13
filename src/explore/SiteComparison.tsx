import { useEffect, useId, useState } from 'react'
import type { RankedSite } from './siteRanking'
import { comparisonDifferences, sameRanking } from './explorationJourney'
import { useScreenDigest } from '../lib/screenDigest'

type Props = {
  ranks: RankedSite[]; slug: string; name: (slug: string) => string
  context: string; onVisit?: (slug: string) => void; onRecord: (text: string) => void
}
export function SiteComparison(p: Props) {
  const id = useId(), [choice, setChoice] = useState('')
  const a = p.ranks.find(r => r.slug === p.slug), others = p.ranks.filter(r => r.slug !== p.slug)
  const choiceAvailable = others.some(r => r.slug === choice), firstOther = others[0]?.slug
  // Streaming rankings can reorder as sites finish loading; keep the visitor's selected alternative stable.
  useEffect(() => { if (!choiceAvailable && firstOther) setChoice(firstOther) }, [choiceAvailable, firstOther])
  const b = others.find(r => r.slug === choice) ?? others[0]
  const digest = a && b ? [
    { id: 'pair-context', label: 'Selected two-site comparison assumptions', value: p.context },
    ...[a, b].map((r, i) => ({ id: `pair-${i}`, label: i ? 'Selected alternative site' : 'Current comparison site', value: `${p.name(r.slug)}: ${r.result.pass ? 'meets' : 'misses'}; Sun ${r.result.litPct.toFixed(1)}%; darkness ${r.result.longestDarkH.toFixed(1)} h; Earth ${r.result.linkPct.toFixed(1)}%; longest Earth gap ${r.result.longestGapH.toFixed(1)} h; minimum battery ${r.result.power ? `${r.result.power.minPct.toFixed(1)}%` : 'not assessed'}; margin ${r.result.margin}`, source: 'Same arrival, equipment and requirements. Nominal landing coordinates. Catalogue order breaks exact ranking ties.' })),
  ] : null
  useScreenDigest('surface-site-comparison', digest, JSON.stringify(digest))
  if (!a || !b) return <p role="status">Loading another site for comparison…</p>
  const differences = comparisonDifferences(a, b, p.name(a.slug), p.name(b.slug))
  const tied = sameRanking(a, b)
  const rows = (r: RankedSite) => [
    ['Sun above skyline', `${r.result.litPct.toFixed(1)}%`],
    ['Longest darkness', `${r.result.longestDarkH.toFixed(1)} h`],
    ['Earth above skyline', `${r.result.linkPct.toFixed(1)}%`],
    ['Longest Earth gap', `${r.result.longestGapH.toFixed(1)} h`],
    ['Minimum battery', r.result.power ? `${r.result.power.minPct.toFixed(1)}%` : 'Not assessed'],
  ]
  const record = () => p.onRecord(`Site comparison. ${p.context}. ${p.name(a.slug)}: ${a.result.pass ? 'meets' : 'misses'} requirements; ${rows(a).map(r => r.join(': ')).join('; ')}. ${p.name(b.slug)}: ${b.result.pass ? 'meets' : 'misses'} requirements; ${rows(b).map(r => r.join(': ')).join('; ')}. ${tied ? 'Equal ranking margin; catalogue order breaks the tie. ' : ''}${differences.join(' ')} Predictions for the nominal landing coordinates, not a landing-safety assessment.`)
  return <div className="site-comparison">
    <label htmlFor={id}>Compare your current site with</label>
    <select id={id} value={b.slug} onChange={e => setChoice(e.target.value)}>{others.map(r => <option key={r.slug} value={r.slug}>{p.name(r.slug)}</option>)}</select>
    <p className="comparison-context">Same arrival, duration and equipment · nominal landing coordinates.</p>
    <p className="comparison-key">{differences[0]}</p>
    <div className="comparison-pair">{[a, b].map(r => <section key={r.slug} aria-label={p.name(r.slug)}>
      <span className="comparison-position">{r === a ? 'You are here' : 'Alternative site'}</span>
      <h3>{p.name(r.slug)}</h3><p data-meets={r.result.pass}>{r.result.pass ? 'Meets these requirements' : 'Misses these requirements'}</p>
      <dl>{rows(r).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {r === b && p.onVisit && <button className="field-button" onClick={() => p.onVisit?.(r.slug)}>Visit this site</button>}
    </section>)}</div>
    <details className="comparison-explanation"><summary>What changes and how are sites ranked?</summary>
      {differences.length > 1 && <ul>{differences.slice(1).map(d => <li key={d}>{d}</li>)}</ul>}
      {tied && <p>These sites have equal ranking margins. Their listed order follows the catalogue; it does not establish that one is superior.</p>}
      {!tied && <p>{a.result.pass && b.result.pass ? 'Both meet your requirements. ' : 'Sites meeting your requirements come first. '}The ranking uses the smallest remaining margin across your chosen limits.</p>}
      <p>Predictions for the nominal landing coordinates, not a landing-safety assessment.</p>
    </details>
    <button className="field-button" onClick={record}>Save comparison to journal</button>
  </div>
}
