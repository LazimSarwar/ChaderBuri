/** The two heights the visitor needs to keep apart: their camera eye and the mission analysis point. */
export function HeightNote({ eyeHeightM, analysisObserverHeightM, missionLinked }: { eyeHeightM: number; analysisObserverHeightM: number; missionLinked: boolean }) {
  const m = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)} m`
  return <div className="field-height-note">
    <p>Your eye: {m(eyeHeightM)} above the ground (camera). Mission analysis: {m(analysisObserverHeightM)} at the landing point.</p>
    {missionLinked && <p>Walking around does not change your mission’s verdict.</p>}
  </div>
}
