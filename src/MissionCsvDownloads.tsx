import { useEffect, useState } from 'react'
import { missionCsv, type MissionCsvInput, type MissionCsvKind } from './lib/missionCsv'
import './mission-csv.css'

/** Download only on request; the displayed scenario and numerical models are left alone. */
export function MissionCsvDownloads(input: MissionCsvInput) {
  const [status, setStatus] = useState(''), [error, setError] = useState(false)
  const key = JSON.stringify(input.scenarios)
  useEffect(() => { setStatus(''); setError(false) }, [key, input.index.datasetId])
  const download = (kind: MissionCsvKind) => {
    try {
      const csv = missionCsv(input, kind)
      const url = URL.createObjectURL(new Blob([csv.text], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = csv.filename
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500)
      setError(false); setStatus(`Downloaded ${kind === 'hourly' ? 'hourly data' : 'mission events'} for ${input.scenarios.length === 1 ? 'this mission' : `all ${input.scenarios.length} options`}.`)
    } catch (e) { setError(true); setStatus(e instanceof Error ? e.message : 'The CSV could not be prepared. Reload the site data and try again.') }
  }
  return <details className="mission-csv">
    <summary>Download CSV data</summary>
    <p>{input.scenarios.length === 1 ? 'This mission' : `All ${input.scenarios.length} options`}, with UTC times, units, requirements, hardware and source fingerprints. Uses the same calculations as this view.</p>
    <div className="mission-csv-actions"><button type="button" className="dash-btn" onClick={() => download('hourly')}>Download hourly CSV</button><button type="button" className="dash-btn" onClick={() => download('events')}>Download events CSV</button></div>
    <small>Hourly data includes interval starts and a final boundary sample. Blank cells have no assessed value; event times are estimates. Spreadsheet text that could be a formula is prefixed with an apostrophe.</small>
    {status && <p role={error ? 'alert' : 'status'}>{status}</p>}
  </details>
}
