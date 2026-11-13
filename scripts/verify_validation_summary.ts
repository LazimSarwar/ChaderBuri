import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BENCHMARK_FILES, regionalValidationSummary, validateBenchmarkReports } from '../src/lib/validationSummary.ts'

let checks = 0
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++ }
const reports = BENCHMARK_FILES.map(file => JSON.parse(readFileSync(`public/data/benchmark/${file}`, 'utf8')))
validateBenchmarkReports(reports); checks++
const before = JSON.stringify(reports)
const summary = regionalValidationSummary(reports)
check(summary.status === 'Unexplained difference', 'Regional comparison never becomes a global accuracy pass')
check(summary.cloneCount === 100, 'The summary identifies complete ensembles')
for (const [height, text] of [[1, summary.oneM], [5, summary.fiveM]] as const) {
  const value = reports[2].rows.find(row => row.mastHeightM === height)!.difference.meanPct
  check(text.includes(Math.abs(value).toFixed(2)), 'Displayed differences derive from the matched artifact')
  check(text.startsWith(value >= 0 ? '+' : '-'), 'Residual direction is explicit')
  check(text.includes('percentage points'), 'Absolute percentage-point differences are not called percent accuracy')
}
check(summary.scope.includes('one region only') && summary.scope.includes('Observer heights'), 'Spatial and height scope are explicit')
check(JSON.stringify(reports) === before, 'Formatting does not mutate comparison products')

const negative = structuredClone(reports)
negative[2].rows[0].difference.meanPct = -0.123
check(regionalValidationSummary(negative).oneM === '-0.12 percentage points', 'Negative residuals remain signed rather than disappearing')

const reject = (change: (copy: typeof reports) => void, message: string) => {
  const copy = structuredClone(reports); change(copy)
  assert.throws(() => validateBenchmarkReports(copy), message); checks++
}
reject(copy => { copy.pop() }, 'A missing product cannot be summarized as a completed check')
reject(copy => { copy[2].cloneCount = 99 }, 'A partial ensemble cannot stand in for 100 clones')
reject(copy => { copy[1].rows[0].difference.meanPct = NaN }, 'Nonfinite differences never reach the display')
reject(copy => { copy[2].rows[1].mastHeightM = 1 }, 'A duplicate height cannot masquerade as both observer heights')
reject(copy => { copy[2].rows[0].published.meanPct += 1 }, 'Mismatched published references cannot be combined')
reject(copy => { delete copy[2].rows[0].ensemblePercentile }, 'The ensemble result must exist')
reject(copy => { copy[0].rows[0].published = null }, 'Malformed reference products fail closed')
assert.throws(() => validateBenchmarkReports(null)); checks++
console.log(`Validation summary: ${checks} checks passed`)
