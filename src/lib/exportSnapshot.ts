import type { PredictionIndex } from './predictionIndex.ts'
/** Preserve the model inputs' identities; a later link may use a refreshed deployment. */
export function exportSnapshot(index:PredictionIndex,slugs:string[]) {
  const files:PredictionIndex['files']={}
  for(const path of Object.keys(index.files))if(path==='/data/sites.json'||path==='/data/terrain/manifest.json'||slugs.some(slug=>path===`/data/horizons/${slug}.json`||path===`/data/dutycycle/${slug}.json`||path===`/data/dispersion/${slug}.json`||path===`/data/ephemeris/${slug}.sun.json`||path===`/data/ephemeris/${slug}.earth.json`||path===`/data/validation/sites/${slug}.json`))files[path]={...index.files[path]}
  for(const slug of slugs)for(const path of [`/data/horizons/${slug}.json`,`/data/ephemeris/${slug}.sun.json`,`/data/ephemeris/${slug}.earth.json`])if(!files[path])throw new Error('Export lacks an indexed source product')
  return {datasetId:index.datasetId,coverage:{...index.coverage},productFingerprints:files,model:{version:index.model.version,sha256:index.model.sha256,sourceFingerprints:{...index.model.files}},analysisObserverHeightM:index.analysisObserverHeightM,interpretation:'Fingerprints identify the source snapshot. Links recalculate using the deployed snapshot. Preserve these products to reproduce the calculation.'}
}
