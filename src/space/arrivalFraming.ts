const RAD = Math.PI / 180

/** Frame the local ground and descending lander together. Only the viewing direction and lens change. */
export function landingFraming(padPitch: number, landerPitch: number) {
  const pitch = padPitch + (landerPitch - padPitch) * .42
  const half = Math.max(Math.abs(padPitch - pitch), Math.abs(landerPitch - pitch))
  return { pitch, fov: Math.max(42, Math.min(100, 2 * half / RAD + 14)) }
}
