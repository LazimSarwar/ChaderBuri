import { Quaternion, Vector3 } from 'three'

/** A great-circle direction and logarithmic distance keep interplanetary travel smooth,
 * including exactly opposite directions. Position is relative to the new focus. */
export function travelPosition(
  from: Vector3,
  to: Vector3,
  t: number,
  out = new Vector3(),
) {
  const a = Math.max(from.length(), 1e-6),
    b = Math.max(to.length(), 1e-6)
  const start =
    from.lengthSq() > 1e-12 ? from.clone().normalize() : to.clone().normalize()
  const turn = new Quaternion().setFromUnitVectors(
    start,
    to.clone().normalize(),
  )
  return out
    .copy(start)
    .applyQuaternion(new Quaternion().slerp(turn, t))
    .multiplyScalar(Math.exp(Math.log(a) * (1 - t) + Math.log(b) * t))
}
