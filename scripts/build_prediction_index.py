"""Compatibility entry point; npm builds use the Node-only index generator."""
import pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
if __name__=='__main__':subprocess.run(['node',str(ROOT/'scripts/build_prediction_index.mjs')],cwd=ROOT,check=True)
