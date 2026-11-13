"""Analytic linear-limb-darkening diagnostic; no fitted solar coefficient."""
import numpy as np

def visible_fraction(clearance_ratio, coefficient=0.0):
    if not 0 <= coefficient <= 1:
        raise ValueError('Linear limb coefficient must be within [0, 1]')
    q = np.clip(np.asarray(clearance_ratio), -1.0, 1.0)
    area = np.arccos(-q) + q * np.sqrt(np.maximum(0.0, 1.0-q*q))
    mu = np.pi * (1/3 + q/2 - q*q*q/6)
    return ((1-coefficient)*area + coefficient*mu) / (np.pi*(1-coefficient/3))
