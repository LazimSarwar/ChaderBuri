"""Verify ensemble order of operations and fail-closed provenance checks."""
import copy
import json
import pathlib
import tempfile
import unittest
import numpy as np
from build_benchmark import cache_reusable, digest
from build_benchmark_ensemble import validate_report, aggregate_reports


def fixture(index):
    return {'version':2,'pixelCount':532,'hours':17544,'start':'2024-01-01T00:00:00Z','stop':'2026-01-01T00:00:00Z',
        'matching':['registered centres'],'differences':['controlled model'],
        'audit':{'generatorSha256':'generator'},
        'sources':[{'path':'nominal.tif','sha256':'common'},{'path':f'Site01_final_adj_5mpp_{index:04d}_err.tif','sha256':str(index)}],
        'rows':[{'mastHeightM':h,'nominal':{'meanPct':index-1.,'longestLightDays':index-1.,'longestDarkDays':index-1.},
                 'published':{'meanPct':70.,'longestLightDays':136.,'longestDarkDays':13.}} for h in (1,5)]}


class EnsembleChecks(unittest.TestCase):
    def test_quantile_direction_and_interpolation(self):
        reports=[fixture(i) for i in range(1,101)]
        for row in aggregate_reports(reports):
            self.assertAlmostEqual(row['ensemblePercentile']['meanPct'],.99)
            self.assertAlmostEqual(row['ensemblePercentile']['longestLightDays'],.99)
            self.assertAlmostEqual(row['ensemblePercentile']['longestDarkDays'],98.01)

    def test_incomplete_rejected(self):
        with self.assertRaises(ValueError): aggregate_reports([fixture(i) for i in range(1,100)])

    def test_mixed_sources_and_methods_rejected(self):
        for key in ('sources','differences','start','matching'):
            reports=[fixture(i) for i in range(1,101)]
            if key=='sources': reports[50][key][0]['sha256']='changed'
            else: reports[50][key]='changed'
            with self.assertRaises(ValueError): aggregate_reports(reports)

    def test_checkpoint_validation(self):
        validate_report(fixture(1),1,'generator','1')
        for mutate in (lambda r:r['audit'].update(generatorSha256='old'),
                       lambda r:r.update(pixelCount=531),
                       lambda r:r['sources'][1].update(sha256='wrong'),
                       lambda r:r['rows'].append(copy.deepcopy(r['rows'][0])),
                       lambda r:r['rows'][0]['nominal'].update(meanPct=float('nan'))):
            r=fixture(1); mutate(r)
            with self.assertRaises(ValueError): validate_report(r,1,'generator','1')

    def test_reference_mismatch_rejected(self):
        reports=[fixture(i) for i in range(1,101)]
        reports[10]['rows'][0]['published']['meanPct']=71
        with self.assertRaises(ValueError): aggregate_reports(reports)

    def test_unfinished_report_rejected(self):
        r=fixture(1); r['pendingCalculation']=True
        with self.assertRaises(ValueError): validate_report(r,1,'generator','1')

    def test_copied_report_rejected(self):
        # Matched clone 14 was published with clone 1's metrics after an interrupted run.
        reports=[fixture(i) for i in range(1,101)]
        reports[13]['rows']=copy.deepcopy(reports[0]['rows'])
        with self.assertRaises(ValueError): aggregate_reports(reports)

    def test_cache_reuse_requires_same_sources_and_generator(self):
        sources=[{'path':'clone.tif','sha256':'1'}]
        previous={'version':2,'sources':sources,'audit':{'generatorSha256':'g1'}}
        self.assertTrue(cache_reusable(previous,sources,'g1'))
        self.assertFalse(cache_reusable(previous,sources,'g2'),'changed generator code must recompute')
        self.assertFalse(cache_reusable(previous,[{'path':'clone.tif','sha256':'2'}],'g1'))
        self.assertFalse(cache_reusable({'version':1,'sources':sources},sources,'g1'),'unaudited report')
        self.assertFalse(cache_reusable({},sources,'g1'))

    def test_paired_worker_seed_hands_over_caches_but_never_validates(self):
        import build_benchmark
        import run_benchmark_paired_worker as worker
        with tempfile.TemporaryDirectory() as directory:
            folder=pathlib.Path(directory)
            clone=folder/'Site01_final_adj_5mpp_0007_err.tif'; clone.write_bytes(b'clone')
            cache=folder/'horizons.npz'; cache.write_bytes(b'horizons')
            sun=folder/'sun.npy'; sun.write_bytes(b'sun')
            sources=[{'path':clone.name,'sha256':digest(clone)}]
            report=folder/'seed.json'
            worker.seed_report(report,sources,clone,cache,sun,build_benchmark)
            seed=json.loads(report.read_text(encoding='utf-8'))
            generator=digest(pathlib.Path(build_benchmark.__file__))
            self.assertTrue(cache_reusable(seed,sources,generator),'calculation.run must reuse the paired horizons')
            self.assertNotIn('rows',seed,'a seed carries no metrics from another clone')
            with self.assertRaises(ValueError): validate_report(seed,7,generator,digest(clone))


if __name__=='__main__': unittest.main()
