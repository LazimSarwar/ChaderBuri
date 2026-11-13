import assert from 'node:assert/strict'
import { initialIntake, validateIntake, type IntakeDraft } from '../src/lib/missionIntake.ts'
import { nextSetupStep } from '../src/lib/setupNavigation.ts'

let checks = 0
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++ }
const start = Date.parse('2026-09-01T00:00:00Z'), hours = 2400
const good: IntakeDraft = { ...initialIntake(start, hours, 24), equipment: 'custom', missionDays: 7 }
const full = (draft: IntakeDraft) => validateIntake(draft, start, hours)

// Reproduce clear-equipment -> Back -> Continue without discarding or repairing the visitor's draft.
for (const name of ['panelAreaM2', 'loadW', 'capacityKWh', 'reservePct'] as const) {
  const broken = { ...good, [name]: NaN }, validation = full(broken)
  check(!validation.ok, `The existing validator rejects missing ${name}`)
  check(nextSetupStep(1, [], validation).step === 2, `Priorities can return to missing ${name}`)
  check(nextSetupStep(0, [], validation).step === 1, `Dates can continue while ${name} is on a later step`)
  const blocked = nextSetupStep(2, [{ name, message: `${name}: enter a value` }], validation)
  check(blocked.step === 2 && blocked.fields[0] === name && blocked.errors.length === 1, `${name} is corrected on its own step`)
  check(nextSetupStep(2, [], full(good)).step === 3, `${name} repair reaches comparison`)
  check(Number.isNaN(broken[name]), `Navigation never changes missing ${name} into a fabricated value`)
}

for (const name of ['minLitPct', 'maxDarkH', 'minLinkPct', 'maxGapH'] as const) {
  const broken = { ...good, [name]: NaN }, validation = full(broken)
  check(nextSetupStep(0, [], validation).step === 1, `Dates can reach missing ${name}`)
  const blocked = nextSetupStep(1, [{ name, message: `${name}: enter a value` }], validation)
  check(blocked.step === 1 && blocked.fields[0] === name, `Hidden disclosure's ${name} stays on the requirements step`)
  check(nextSetupStep(1, [], full(good)).step === 2, `${name} repair reaches equipment`)
}

for (const [name, draft] of [
  ['landingUTC', { ...good, landingUTC: '' }],
  ['missionDays', { ...good, missionDays: NaN }],
] as const) {
  const blocked = nextSetupStep(0, [{ name, message: `${name}: enter a value` }], full(draft))
  check(blocked.step === 0 && blocked.fields[0] === name, `Missing ${name} stays editable on dates`)
}

// A live coverage change can invalidate a previously valid date while equipment is open.
const shortened = validateIntake(good, start, 96)
check(!shortened.ok, 'The existing coverage guard still rejects a now-incomplete mission')
const returned = nextSetupStep(2, [], shortened)
check(returned.step === 0 && returned.errors.length > 0, 'Full validation sends the visitor back to editable dates')
check(nextSetupStep(2, [], full({ ...good, panelAreaM2: NaN })).step !== 3, 'No native-constraint bypass can enter comparison with an invalid full draft')
check(nextSetupStep(2, [], full({ ...good, equipment: 'example', panelAreaM2: NaN })).step === 3, 'Unused custom equipment remains ignored by the unchanged example-lander validator')
check(nextSetupStep(2, [{ name: 'panelAreaM2', message: 'Visible field error' }], full(good)).step === 2, 'A visible native field error blocks even before the full draft can be applied')

console.log(`Setup navigation recovery checks passed: ${checks}`)
