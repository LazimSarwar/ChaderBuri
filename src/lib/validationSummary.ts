export type BenchmarkMetrics = { meanPct: number; longestLightDays: number; longestDarkDays: number }
export type BenchmarkRow = {
  mastHeightM: number
  published: BenchmarkMetrics
  difference: BenchmarkMetrics
  nominal?: BenchmarkMetrics
  ensemblePercentile?: BenchmarkMetrics
}
export type BenchmarkReport = {
  pixelCount?: number; areaM2?: number; hours?: number; cloneCount?: number
  rows: BenchmarkRow[]; paperUrl?: string; dataUrl?: string; limits?: string[]; sources: unknown[]
}
export const BENCHMARK_FILES = ['barker2021-roi4.json', 'barker2021-roi4-ensemble.json', 'barker2021-roi4-matched-ensemble.json'] as const
export const MATCHED_COMPARISON_ID = 'matched-illumination-details'
const METRIC_KEYS = ['meanPct', 'longestLightDays', 'longestDarkDays'] as const

/** These are existing published products, never a request to run the benchmark. */
export function validateBenchmarkReports(values: unknown): asserts values is BenchmarkReport[] {
  if (!Array.isArray(values) || values.length !== BENCHMARK_FILES.length) throw new Error('Incomplete comparison products')
  for (const [i, value] of values.entries()) {
    const report = value as BenchmarkReport | null
    if (!report || !Array.isArray(report.rows) || report.rows.length !== 2 || !Array.isArray(report.sources) ||
      new Set(report.rows.map(r => r?.mastHeightM)).size !== 2 || report.rows.some(row =>
        !row || ![1, 5].includes(row.mastHeightM) || METRIC_KEYS.some(key =>
          ![row.published?.[key], row.difference?.[key], (i === 0 ? row.nominal : row.ensemblePercentile)?.[key]].every(Number.isFinite)))) {
      throw new Error('Invalid published comparison product')
    }
    if (i > 0 && report.cloneCount !== 100) throw new Error('Incomplete ensemble report')
  }
  for (const report of values.slice(1) as BenchmarkReport[]) for (const row of report.rows) for (const key of METRIC_KEYS) {
    if (row.published[key] !== values[0].rows.find((r: BenchmarkRow) => r.mastHeightM === row.mastHeightM)?.published[key]) {
      throw new Error('Reference statistics disagree')
    }
  }
}

export type RegionalSummary = { status: 'Unexplained difference'; cloneCount: number; oneM: string; fiveM: string; scope: string }
const points = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)} percentage points`
export function regionalValidationSummary(reports: BenchmarkReport[]): RegionalSummary {
  validateBenchmarkReports(reports)
  const matched = reports[2]
  return {
    status: 'Unexplained difference', cloneCount: matched.cloneCount!,
    oneM: points(matched.rows.find(r => r.mastHeightM === 1)!.difference.meanPct),
    fiveM: points(matched.rows.find(r => r.mastHeightM === 5)!.difference.meanPct),
    scope: 'Matched model · Connecting Ridge, ROI 4 · mean illumination metric. Observer heights above ground; one region only.',
  }
}
