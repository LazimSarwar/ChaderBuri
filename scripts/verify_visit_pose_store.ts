import assert from 'node:assert/strict'
import { createVisitPoseStore } from '../src/explore/visitPoseStore.ts'

const store = createVisitPoseStore()
let notifications = 0, shellTransitions = 0
const unsubscribe = store.subscribe(() => { notifications++ })
const report = (pose: Parameters<typeof store.publish>[0]) => { if (store.publish(pose)) shellTransitions++ }

assert.equal(store.getSnapshot(), null)
report(null)
assert.equal(notifications, 0)
const initial = { heading: 87, pitch: 0, fov: 60, eastM: 0, northM: 0, walking: false }
report(initial)
const firstSnapshot = store.getSnapshot()
assert.notEqual(firstSnapshot, initial, 'Caller mutations must not alter the snapshot')
initial.heading = 999
assert.equal(firstSnapshot?.heading, 87)
assert.equal(store.getSnapshot(), firstSnapshot, 'Snapshots stay stable between reports')
report({ ...firstSnapshot! })
assert.equal(notifications, 1, 'Repeated identical poses must not redraw subscribers')
for (let i = 1; i <= 600; i++) report({ heading: i % 360, pitch: -5, fov: 60, eastM: i / 10, northM: 2, walking: true, trailSteps: Math.floor(i / 7) })
assert.equal(shellTransitions, 1, 'A continuous walk must not produce App entry/exit updates')
assert.equal(store.getSnapshot()?.eastM, 60, 'Field subscribers receive the latest position')
report({ ...store.getSnapshot()!, walking: false, airborne: true, verticalMps: 2 })
assert.equal(store.getSnapshot()?.airborne, true, 'Jump state stays live')
report({ ...store.getSnapshot()!, airborne: false, verticalMps: 0 })
assert.equal(store.getSnapshot()?.airborne, false, 'Landing state stays live')
report(null)
assert.equal(shellTransitions, 2, 'Exit is a single shell transition')
assert.equal(store.getSnapshot(), null, 'Exit clears the pose')
const beforeUnsubscribe = notifications
unsubscribe()
report({ heading: 0, pitch: 0, fov: 60, eastM: 0 })
assert.equal(notifications, beforeUnsubscribe, 'Unmounted leaves receive no notifications')
assert.equal(createVisitPoseStore().getSnapshot(), null, 'Stores are isolated between app instances')
assert.equal(shellTransitions, 3, 'A new visit produces a fresh entry transition')
let focusNotifications = 0
const releaseFocus = store.subscribeFocus(() => { focusNotifications++ })
store.publishFocus({ object: 'antenna', label: 'Aim antenna', distanceM: 2 })
assert.equal(store.getFocusSnapshot()?.distanceM, 2)
store.publishFocus({ object: 'antenna', label: 'Aim antenna', distanceM: 2 })
assert.equal(focusNotifications, 1, 'Unchanged reticle readings do not redraw')
store.publishFocus({ object: 'antenna', label: 'Aim antenna', distanceM: 1.5 })
assert.equal(store.getFocusSnapshot()?.distanceM, 1.5, 'Distances update without a shell transition')
assert.equal(shellTransitions, 3)
report(null)
assert.equal(store.getFocusSnapshot(), null, 'Leaving clears the previous reticle target')
releaseFocus()
console.log('Visit pose lifecycle, 600 motion reports, jump/landing, deduplication and cleanup checks passed.')
