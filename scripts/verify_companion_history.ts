import assert from 'node:assert/strict'
import { appendConversation, COMPANION_HISTORY_KEY, MAX_COMPANION_HISTORY, parseCompanionHistory, readCompanionHistory, writeCompanionHistory, type ConversationEntry } from '../src/lib/companionHistory.ts'

let checks = 0
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++ }
const entry: ConversationEntry = { id: 'ai:1', at: 1, question: 'এখানে আলো আছে?', answer: 'At the selected date, the Sun is behind the measured terrain.', source: 'ai', contextStamp: 'scene-A', siteName: 'Malapert Massif', sceneUTC: '2026-11-14T18:00:00.000Z' }
const backing = new Map<string, string>()
const storage = { getItem: (key: string) => backing.get(key) ?? null, setItem: (key: string, value: string) => { backing.set(key, value) }, removeItem: (key: string) => { backing.delete(key) } }
check(readCompanionHistory(storage).length === 0, 'A new browser starts with an empty conversation')
const live = appendConversation([], entry)
check(live.length === 1 && live[0].restored === false, 'A live message is recorded once')
check(appendConversation(live, entry) === live, 'Repeated effects do not duplicate a message')
check(writeCompanionHistory(live, storage), 'Conversation can be saved in browser storage')
const restored = readCompanionHistory(storage)
check(restored.length === 1 && restored[0].question === entry.question && restored[0].answer === entry.answer, 'Unicode questions and exact answer text survive a reload')
check(restored[0].restored === true && restored[0].contextStamp === 'scene-A' && restored[0].sceneUTC === entry.sceneUTC, 'Restored answers retain the original conditions and a historical flag')
const injected = { ...entry, action: { kind: 'setEquipment', value: 'loadW=0' }, suggestion: { action: { kind: 'visit', value: 'unknown-site' } }, reply: { action: { kind: 'jump' } }, evidence: { apiKey: 'test-secret-must-not-save' } }
const cleaned = parseCompanionHistory(JSON.stringify({ v: 1, entries: [injected] }))
check(cleaned.length === 1 && !('action' in cleaned[0]) && !('reply' in cleaned[0]) && !('evidence' in cleaned[0]) && !('suggestion' in cleaned[0]), 'Browser content cannot hydrate commands, evidence or offers into the live session')
check(writeCompanionHistory([injected] as ConversationEntry[], storage) && !backing.get(COMPANION_HISTORY_KEY)?.includes('test-secret'), 'Saving also strips unknown payloads instead of serializing raw turns')
const malformed = [null, '', '{', JSON.stringify({ v: 2, entries: [entry] }), JSON.stringify({ v: 1, entries: null }), 'x'.repeat(160_001)]
for (const raw of malformed) check(parseCompanionHistory(raw).length === 0, 'Malformed, unsupported or oversized storage is ignored')
for (const bad of [{ ...entry, id: '' }, { ...entry, question: 42 }, { ...entry, answer: 'x'.repeat(4001) }, { ...entry, source: 'command' }, { ...entry, at: null }, { ...entry, at: -1 }, { ...entry, contextStamp: '' }]) check(parseCompanionHistory(JSON.stringify({ v: 1, entries: [bad] })).length === 0, 'Invalid record is not rendered as conversation')
const mixed = parseCompanionHistory(JSON.stringify({ v: 1, entries: [null, entry, entry, { ...entry, id: 'second', sceneUTC: 'invalid date' }] }))
check(mixed.length === 2 && mixed[1].sceneUTC === null, 'Invalid items, duplicate ids and invalid dates are handled without losing valid text')
let many: ConversationEntry[] = []
for (let i = 0; i < 50; i++) many = appendConversation(many, { ...entry, id: `record:${i}`, at: i })
check(many.length === MAX_COMPANION_HISTORY && many[0].id === 'record:26' && many.at(-1)?.id === 'record:49', 'Only the most recent bounded conversation is retained')
const large = many.map(e=>({...e,question:'q'.repeat(1000),answer:'a'.repeat(4000),contextStamp:'c'.repeat(6000)}))
check(writeCompanionHistory(large,storage) && backing.get(COMPANION_HISTORY_KEY)!.length<=160_000 && readCompanionHistory(storage).at(-1)?.id==='record:49', 'The total saved document is bounded while preserving the newest answer')
const blocked = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('quota') }, removeItem: () => { throw Error('blocked') } }
check(readCompanionHistory(blocked).length === 0 && !writeCompanionHistory(live, blocked), 'Disabled storage and quota errors preserve an in-memory experience')
check(!writeCompanionHistory(live, null) && readCompanionHistory(null).length === 0, 'A browser without storage does not crash')
check(writeCompanionHistory([], storage) && !backing.has(COMPANION_HISTORY_KEY), 'Clear conversation removes the stored document')
console.log(`Companion history: ${checks} checks passed; live provider calls: 0.`)
