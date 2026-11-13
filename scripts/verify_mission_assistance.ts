import assert from 'node:assert/strict'
import { parseCompanionRequest, guardReply, asksForAction, checkedCompanionReply, type CompanionReply, type CompanionEvidence } from '../src/lib/lunarCompanion.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'

let checks=0
const check=(fn:()=>void)=>{fn();checks++}
const constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER}},before=JSON.stringify(constraints)
for(const screen of ['setup','guide','weather']){
 const context={slug:'malapert-massif',row:1794,constraints,datasetId:'a'.repeat(64),model:'test',view:{screen,search:''},basis:'scene' as const}
 const parsed=parseCompanionRequest({context,messages:[{role:'user',content:'Explain the values I can see.'}]})
 check(()=>assert.equal(parsed.context.view?.screen,screen))
 check(()=>assert.equal(parsed.context.row,1794))
 check(()=>assert.equal(parsed.context.constraints.power?.capacityWh,constraints.power?.capacityWh))
 const reply:CompanionReply={message:'Let’s read the displayed values.',action:{kind:'highlight',value:'battery'},suggestion:null,visitSlug:null,focus:'none',questions:[],proposedMission:null}
 const guarded=guardReply('Why does this number change?',reply,screen)
 check(()=>assert.equal(guarded.action,null))
 check(()=>assert.equal(guarded.suggestion?.action.kind,'highlight'))
 check(()=>assert.equal(guardReply('Highlight the battery row',reply,screen).action?.kind,'highlight'))
}
const reply:CompanionReply={message:'Here is the battery.',action:{kind:'highlight',value:'battery'},suggestion:null,visitSlug:null,focus:'none',questions:[],proposedMission:null}
check(()=>assert.equal(guardReply('Why is the battery low?',reply,'plan').action?.kind,'highlight'))
check(()=>assert.equal(guardReply('Why is the battery low?',reply,'compare').action?.kind,'highlight'))
check(()=>assert.equal(JSON.stringify(constraints),before))
for(const question of ['What does this mean? Please use plain words.','Explain this. Use a simple example.','What is my reserve? Please answer in English.','Show me how to change the landing time.','Please tell me why the battery is low.'])check(()=>assert.equal(asksForAction(question),false))
for(const command of ['Please open the map.','Use option B.','What does this mean? Open the map.','Help me open the calendar.','Show me where Earth is.'])check(()=>assert.equal(asksForAction(command),true))
check(()=>assert.equal(guardReply('What does “0 reported” for energetic particles mean here, and what should I do next? Please use plain words.',{...reply,action:{kind:'weather',value:''}},'surface').action,null))
const evidence:CompanionEvidence={context:{slug:'malapert-massif',row:1794,constraints,datasetId:'a'.repeat(64),model:'test'},landingUTC:'2026-11-14T18:00:00Z',endUTC:'2026-11-28T18:00:00Z',observerHeightM:0,sites:[],eligibleSlugs:[],unavailableSlugs:[],scope:[]}
check(()=>assert.equal(checkedCompanionReply({...reply,message:'These reports do not change your mission’s calculated success.'},evidence).message,'These reports do not change your mission’s calculated result.'))
check(()=>assert.equal(checkedCompanionReply({...reply,message:'Uncalculated success metrics are not available.'},evidence).message,'Uncalculated success metrics are not available.'))
check(()=>assert.equal(checkedCompanionReply({...reply,message:'এটি গণনার ফল, ২০%।'},evidence).message,'এটি গণনার ফল, 20%।'))
check(()=>assert.throws(()=>parseCompanionRequest({context:{slug:'malapert-massif',row:1794,constraints,datasetId:'a'.repeat(64),model:'test',view:{screen:'unsupported-private-page',search:''}},messages:[{role:'user',content:'Explain'}]}),/workspace view/))
console.log(`Mission assistance context: ${checks} checks passed; live provider calls: 0.`)
