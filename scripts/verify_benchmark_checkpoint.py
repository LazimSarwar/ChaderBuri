"""Interruption/restart tests for lossless horizon checkpoints and signed complete caches."""
import tempfile,unittest
from pathlib import Path
import numpy as np
from benchmark_checkpoint import cache_signature,load_complete,load_partial,save_complete,save_partial

class CheckpointChecks(unittest.TestCase):
    def test_lossless_prefix_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'partial.npz'
            profiles=np.arange(32*2*720,dtype=float).reshape(32,2,720)/10000
            profiles[:,1]=profiles[:,0]-.01
            save_partial(path,profiles,16,'source-v1')
            count,prefix=load_partial(path,32,'source-v1')
            self.assertEqual(count,16);np.testing.assert_array_equal(prefix,profiles[:16])
            restored=np.empty_like(profiles);restored[:count]=prefix;restored[count:]=profiles[count:]
            np.testing.assert_array_equal(restored,profiles)
            save_partial(path,restored,32,'source-v1')
            self.assertEqual(load_partial(path,32,'source-v1')[0],32)
            self.assertFalse(path.with_suffix('.tmp').exists())
    def test_stale_source_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'partial.npz';save_partial(path,np.zeros((16,2,720)),16,'old')
            self.assertIsNone(load_partial(path,532,'new'))
    def test_corruption_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'partial.npz';path.write_bytes(b'broken archive')
            with self.assertRaises(ValueError):load_partial(path,532,'source')
    def test_invalid_heights_and_shape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'partial.npz'
            profiles=np.zeros((16,2,720));profiles[:,1]=1
            with self.assertRaises(ValueError):save_partial(path,profiles,16,'source')
            profiles[:,1]=np.nan
            with self.assertRaises(ValueError):save_partial(path,profiles,16,'source')
            with self.assertRaises(ValueError):save_partial(path,np.zeros((16,1,720)),16,'source')

    # Complete caches: reused only for the same sources and the same generator code.
    def test_complete_cache_signed_by_sources_and_generator(self):
        sources=[{'path':'clone.tif','sha256':'1'}]
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'horizons.npz'
            profiles=np.arange(8*2*720,dtype=float).reshape(8,2,720)/10000;profiles[:,1]=profiles[:,0]-.01
            signature=cache_signature(sources,'generator-v1')
            save_complete(path,profiles,signature)
            np.testing.assert_array_equal(load_complete(path,8,signature),profiles)
            self.assertIsNone(load_complete(path,8,cache_signature(sources,'generator-v2')),'changed code must not reuse')
            self.assertIsNone(load_complete(path,8,cache_signature([{'path':'clone.tif','sha256':'2'}],'generator-v1')),'changed input must not reuse')
            self.assertEqual(sorted(p.name for p in Path(directory).iterdir()),['horizons.npz'],'no temporary left behind')
    def test_unsigned_complete_cache_not_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'horizons.npz'
            np.savez_compressed(path,profiles=np.zeros((8,2,720)))  # the format written before signatures
            self.assertIsNone(load_complete(path,8,cache_signature([],'generator')))
            self.assertIsNone(load_complete(Path(directory)/'absent.npz',8,'any'))
    def test_complete_cache_corruption_and_shape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'horizons.npz';path.write_bytes(b'broken archive')
            with self.assertRaises(ValueError):load_complete(path,8,'source')
            save_complete(path,np.zeros((8,2,720)),'source')
            with self.assertRaises(ValueError):load_complete(path,532,'source')
            profiles=np.zeros((8,2,720));profiles[:,1]=1
            with self.assertRaises(ValueError):save_complete(path,profiles,'source')

if __name__=='__main__':unittest.main()
