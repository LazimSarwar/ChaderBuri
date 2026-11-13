"""Atomic, fail-closed horizon caches for long benchmark runs.

Partial and complete horizon caches both carry the signature of the sources and generator
that produced them; a cache written by other inputs or other code is never reused.
"""
import hashlib
import json
import os
import zipfile
import numpy as np


def cache_signature(sources, generator_sha):
    """Identity of a horizon calculation: its input fingerprints plus the generator fingerprint."""
    return hashlib.sha256(json.dumps({'sources':sources,'generator':generator_sha},sort_keys=True).encode()).hexdigest()


def _check(profiles, count, label):
    if profiles.shape!=(count,2,720):
        raise ValueError(f'Invalid {label} horizon shape/count')
    if not np.isfinite(profiles).all() or not (profiles[:,1]<=profiles[:,0]+1e-10).all():
        raise ValueError(f'Invalid {label} horizons')


def save_partial(path, profiles, completed, signature):
    prefix=profiles[:completed]
    if not 0 < completed <= len(profiles) or prefix.shape!=(completed,2,720):
        raise ValueError('Invalid checkpoint shape/count')
    if not np.isfinite(prefix).all() or not (prefix[:,1]<=prefix[:,0]+1e-10).all():
        raise ValueError('Invalid partial horizons')
    temporary=path.with_suffix('.tmp')
    with temporary.open('wb') as f:
        np.savez_compressed(f,profiles=prefix,completed=completed,signature=signature)
    temporary.replace(path)


def load_partial(path, total, signature):
    if not path.exists(): return None
    try:
        with np.load(path,allow_pickle=False) as cache:
            if str(cache['signature'].item()) != signature: return None
            completed=int(cache['completed'].item()); profiles=cache['profiles'].copy()
        if not 0 < completed <= total or profiles.shape!=(completed,2,720):
            raise ValueError('Invalid partial horizon shape/count')
        if not np.isfinite(profiles).all() or not (profiles[:,1]<=profiles[:,0]+1e-10).all():
            raise ValueError('Invalid partial horizons')
        return completed,profiles
    except (OSError,KeyError,ValueError,zipfile.BadZipFile) as e:
        raise ValueError('Corrupt benchmark checkpoint; refusing reuse: '+str(path)) from e


def save_complete(path, profiles, signature):
    """Write every pixel's horizons with the signature of the calculation that produced them."""
    _check(profiles, len(profiles), 'complete')
    temporary=path.with_name(path.name+f'.{os.getpid()}.tmp')
    with temporary.open('wb') as f:
        np.savez_compressed(f,profiles=profiles,signature=signature)
    temporary.replace(path)


def load_complete(path, total, signature):
    """Complete horizons, or None when absent, unsigned, or signed by other sources or code."""
    if not path.exists(): return None
    try:
        with np.load(path,allow_pickle=False) as cache:
            if 'signature' not in cache.files or str(cache['signature'].item()) != signature: return None
            profiles=cache['profiles'].copy()
    except (OSError,KeyError,ValueError,zipfile.BadZipFile) as e:
        raise ValueError('Corrupt benchmark horizon cache; refusing reuse: '+str(path)) from e
    _check(profiles, total, 'complete')
    return profiles
