import * as T from 'three'
import { UNIT_KM } from './ephemeris'

/**
 * Logarithmic depth measured in metres instead of scene units.
 *
 * three.js writes log2(1 + w) with w in scene units (here 1 unit = 1737.4 km). On a surface visit every object is a
 * few millionths of a unit away, where that curve is linear and 1 + w keeps only a few significant bits in float32:
 * a 24-bit depth buffer then resolves about 2 m, so footpads, tanks, legs and rocks fought the regolith (they looked
 * see-through). Taking the logarithm of the distance in metres, log2(1 + w_m) / log2(1 + far_m), gives micrometre
 * steps at the visitor's feet, millimetres at a kilometre and still orders the planets correctly across the solar
 * system. Same depth for every material (one shared chunk), so the scene stays consistent; orthographic shadow
 * cameras keep ordinary depth as before. Presentation only: no geometry, direction or value changes.
 */
const METRES = (UNIT_KM * 1000).toFixed(1)
let installed = false
export function installMetricLogDepth() {
  if (installed) return
  installed = true
  T.ShaderChunk.logdepthbuf_vertex = /* glsl */`
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = gl_Position.w * ${METRES};
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif
`
  // logDepthBufFC is three's 2 / log2(far + 1) with far in scene units; recover far and rescale it to metres.
  T.ShaderChunk.logdepthbuf_fragment = /* glsl */`
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( 1.0 + max( vFragDepth, 0.0 ) ) / log2( 1.0 + ( exp2( 2.0 / logDepthBufFC ) - 1.0 ) * ${METRES} );
#endif
`
}
installMetricLogDepth()
