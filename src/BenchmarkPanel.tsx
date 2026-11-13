import { useEffect,useState } from 'react'
import { requestJson } from './lib/request'
import { indexedOptions,type PredictionIndex } from './lib/predictionIndex'
import { BENCHMARK_FILES, MATCHED_COMPARISON_ID, validateBenchmarkReports, type BenchmarkReport } from './lib/validationSummary'
type Report=BenchmarkReport
const FILES=BENCHMARK_FILES
const METRICS=[['meanPct','Mean visible disc','%','pp'],['longestLightDays','Longest illumination','d','d'],['longestDarkDays','Longest darkness','d','d']] as const
function Results({report,nominal=false}:{report:Report;nominal?:boolean}){return <div className="benchmark-table-wrap"><table className="benchmark-table"><thead><tr><th>Height</th><th>Metric</th><th>{nominal?'Nominal mean':'Calculated ensemble percentile'}</th><th>Published percentile</th><th>Difference</th></tr></thead><tbody>{report.rows.flatMap(row=>METRICS.map(([key,label,unit,delta])=><tr key={row.mastHeightM+key}><th>{row.mastHeightM} m</th><td>{label}</td><td>{(row.nominal??row.ensemblePercentile)![key].toFixed(2)} {unit}</td><td>{row.published[key].toFixed(2)} {unit}</td><td>{row.difference[key]>=0?'+':''}{row.difference[key].toFixed(2)} {delta}</td></tr>))}</tbody></table></div>}
export type BenchmarkState={reports:Report[]|null;error:string;retry:()=>void}
export function useBenchmarkReports(index:PredictionIndex):BenchmarkState{
 const [reports,setReports]=useState<Report[]|null>(null),[error,setError]=useState('')
 const [attempt,setAttempt]=useState(0)
 useEffect(()=>{const abort=new AbortController();setError('');setReports(null);Promise.resolve().then(()=>Promise.all(FILES.map(file=>{const path='/data/benchmark/'+file;return requestJson(path,indexedOptions(index,path,abort.signal))}))).then(values=>{
   validateBenchmarkReports(values)
   if(!abort.signal.aborted)setReports(values)
 }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:String(e))});return()=>abort.abort()},[index,attempt])
 return {reports,error,retry:()=>setAttempt(n=>n+1)}
}
export function BenchmarkPanel({onExplore,state}:{onExplore:()=>void;state:BenchmarkState}){
 const {reports,error}=state
 const reference=reports?.[1],matched=reports?.[2],one=reference?.rows.find(r=>r.mastHeightM===1),five=reference?.rows.find(r=>r.mastHeightM===5),mOne=matched?.rows.find(r=>r.mastHeightM===1)
 return <section id="regional-illumination-details" className="evidence-card mt-6" aria-label="Published illumination comparison"><p className="eyebrow text-sun">External reference · regional comparison</p><h3>Barker et al. · Connecting Ridge, ROI 4</h3>
 {!reports?<div><p role={error?'alert':'status'}>{error||'Loading fingerprinted comparison products…'}</p>{error&&<button type="button" className="dash-btn" onClick={state.retry}>Retry comparison products</button>}</div>:<>
 <p>{reports[0].pixelCount} original 5 m pixel centres · {reports[0].areaM2?.toLocaleString()} m² · 1 January 2024 to 1 January 2026. Mast means observer height above ground, not DEM resolution.</p>
 <h4 className="mt-3">Reference ensemble · calculated November 2026</h4>
 <p className="benchmark-note">100 original terrain clones, the published percentile statistic, terrain sampled every 0.25 m within 500 m of each observer (finer sampling changes results by at most 0.03 points). At 1 m, mean illumination differs by {one!.difference.meanPct.toFixed(2)} percentage points, longest illumination by {one!.difference.longestLightDays.toFixed(2)} days and longest darkness by {one!.difference.longestDarkDays.toFixed(2)} days. At 5 m, the differences are {five!.difference.meanPct.toFixed(2)} points and {five!.difference.longestLightDays.toFixed(2)} days. The 1 m residual remains unresolved; no numerical acceptance threshold or global accuracy bound is claimed.</p>
 <Results report={reference!}/>
 <p className="benchmark-note">This compares one region at 1 m and 5 m observer heights. The dashboard’s site skylines assume an observer at ground level (0 m); the exploration camera stands at a 1.7 m eye height. Agreement in this one region does not validate every dashboard site or any other observer height, and says nothing about landing safety. The tested far-field and solar-disc changes did not explain the remaining 1 m residual; the authors’ exact terrain archive and radial sampling remain unverified.</p>
 <details className="mt-3"><summary>Other calculations & method limits</summary><h4 className="mt-3">Nominal mean versus published ensemble percentile · different statistics · November 2026</h4><Results report={reports[0]} nominal/>
 <section id={MATCHED_COMPARISON_ID} className="matched-validation-details" tabIndex={-1} aria-labelledby={`${MATCHED_COMPARISON_ID}-heading`}>
 <h4 id={`${MATCHED_COMPARISON_ID}-heading`} className="mt-3">Matched model (Barker terrain grids + 550 nm limb-darkened disc) · calculated November 2026</h4>
 <p className="benchmark-note">The same 100 clones and near-field sampling as the reference ensemble, but with the authors’ legacy 80 m and 240 m far-field grids and a 550 nm limb-darkened solar disc. At 1 m, mean illumination differs from the paper by {mOne!.difference.meanPct>=0?'+':''}{mOne!.difference.meanPct.toFixed(2)} percentage points, {(mOne!.ensemblePercentile!.meanPct-one!.ensemblePercentile!.meanPct)>=0?'+':''}{(mOne!.ensemblePercentile!.meanPct-one!.ensemblePercentile!.meanPct).toFixed(3)} points from the reference ensemble: these terrain-grid and solar-disc choices do not explain the remaining 1 m residual.</p>
 <Results report={matched!}/>
 <ul className="mt-3 list-disc pl-4 text-xs text-inkdim">{reference!.limits?.map(s=><li key={'r'+s}>Reference ensemble: {s}</li>)}{matched!.limits?.map(s=><li key={'m'+s}>Matched model: {s}</li>)}</ul>
 </section></details>
 <div className="mt-4 flex flex-wrap gap-4 text-xs"><button className="text-earth underline" onClick={onExplore}>Explore reference terrain ↗</button><a href={reports[0].paperUrl} target="_blank" rel="noreferrer">Published paper ↗</a><a href={reports[0].dataUrl} target="_blank" rel="noreferrer">Authors’ terrain & clones ↗</a>{FILES.map((file,i)=><a key={file} href={'/data/benchmark/'+file} target="_blank" rel="noreferrer">{['Nominal (Nov 2026)','Reference ensemble (Nov 2026)','Matched ensemble (Nov 2026)'][i]} JSON ↗</a>)}</div>
 </>}
 </section>
}
