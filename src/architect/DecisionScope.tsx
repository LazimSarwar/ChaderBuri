import './decision-scope.css'

/**
 * The scope of a verdict, shown right beside it: where and how often it was calculated, what is measured,
 * predicted or illustrative, and that no uncertainty bound has been established (no ± value is invented).
 */
export function DecisionScope({ heightM }: { heightM: number }) {
  return <p className="decision-scope">
    <strong>Scope:</strong> nominal landing coordinate · hourly samples · LRO LOLA terrain (measured) and JPL Horizons
    positions (predicted) · illustrative lander hardware · {heightM} m analysis height · uncertainty bound not established.
  </p>
}
