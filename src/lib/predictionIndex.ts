import { requestJson, type RequestOptions } from './request.ts'
import { MODEL_SHA256,MODEL_VERSION } from '../modelIdentity.ts'
export type PredictionIndex={schemaVersion:1;generatedUTC:string;datasetId:string;coverage:{start:string;stop:string;samples:number;stepHours:number};files:Record<string,{sha256:string;bytes:number}>;model:{version:string;sha256:string;files:Record<string,string>};analysisObserverHeightM:number}
export function validatePredictionIndex(value:unknown):asserts value is PredictionIndex {
  const p=value as PredictionIndex
  const hash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)
  if(!p||p.schemaVersion!==1||!hash(p.datasetId)||!p.coverage||p.coverage.stepHours!==1||!Number.isInteger(p.coverage.samples)||p.coverage.samples<2||Date.parse(p.coverage.stop)-Date.parse(p.coverage.start)!==(p.coverage.samples-1)*3600000||!p.files||!p.model||!hash(p.model.sha256)||typeof p.model.version!=='string'||!Number.isFinite(p.analysisObserverHeightM))throw new Error('Invalid dataset index')
  for(const [path,f]of Object.entries(p.files))if(!path.startsWith('/data/')||!hash(f.sha256)||!Number.isInteger(f.bytes)||f.bytes<=0)throw new Error('Invalid indexed product')
}
export async function loadPredictionIndex(options:RequestOptions={}){const p=await requestJson('/data/prediction-index.json?model='+MODEL_VERSION,options);validatePredictionIndex(p);if(p.model.sha256!==MODEL_SHA256)throw new Error('Application and data model snapshots differ; reload the updated deployment');return p}
export function indexedOptions(index:PredictionIndex,path:string,signal?:AbortSignal):RequestOptions {
  const file=index.files[path]
  if(!file)throw new Error(`Product is absent from dataset index: ${path}`)
  return {expectedSha256:file.sha256,signal}
}
