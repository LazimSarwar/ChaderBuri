"""Parallel clone-range worker with an audited, read-only PDS storage backend."""
import argparse,json,pathlib,sys,time
import build_benchmark as reference
import build_benchmark_ensemble as ensemble
from benchmark_io import load_dem_mapped


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['reference','matched'],required=True)
    parser.add_argument('--first',type=int,required=True)
    parser.add_argument('--last',type=int,required=True)
    args=parser.parse_args()
    if not 1<=args.first<=args.last<=100:raise ValueError('Invalid clone range')
    if args.mode=='matched':
        import build_benchmark_matched
        calculation=build_benchmark_matched.prepare()
    else:calculation=reference
    calculation.hz.load_dem=load_dem_mapped
    original=calculation.run
    def measured_run(path):
        start=time.perf_counter();original(path)
        report_path=calculation.OUT/(path.stem+'.json')
        report=json.loads(report_path.read_text(encoding='utf-8'))
        report['execution']={'storage':'Read-only int16 memory mapping; bitwise verified against original reader',
            'ioBackendSha256':reference.digest(pathlib.Path(__file__).with_name('benchmark_io.py')),
            'elapsedSeconds':time.perf_counter()-start,'cloneRange':[args.first,args.last]}
        ensemble.atomic_json(report_path,report)
    calculation.run=measured_run
    ensemble.benchmark=calculation
    sys.argv=[sys.argv[0],'--first',str(args.first),'--last',str(args.last)]
    print(f'{args.mode}: clones {args.first}..{args.last}, read-only memory-mapped PDS reader',flush=True)
    ensemble.main()

if __name__=='__main__':main()
