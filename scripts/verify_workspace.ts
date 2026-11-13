import assert from 'node:assert/strict'
import { initialWorkspacePanel, startsInSolarSystem, toggleWorkspacePanel, hasWorkspaceDrawer, WORKSPACE_TOOLS } from '../src/lib/workspace.ts'
import { turnSiteLook, SITE_LOOK_PITCH_LIMIT } from '../src/space/look.ts'
let checks=0
function check(condition:unknown,message:string){assert.ok(condition,message);checks++}
check(initialWorkspacePanel('?site=shackleton-rim&t=1480','')===null,'Default opens the shared scene')
check(initialWorkspacePanel('?c=1&b=malapert-massif','')==='compare','Legacy comparison bookmark opens the drawer')
check(initialWorkspacePanel('?view=plan&c=1','')==='plan','Explicit tool takes priority over the legacy flag')
check(initialWorkspacePanel('?view=unsupported','')===null,'Unknown tool cannot create another window')
check(initialWorkspacePanel('?view=plan','#/validation')==='validation','Legacy validation link opens an embedded tool')
check(!startsInSolarSystem('',''),'Ordinary Start opens on the Moon')
check(startsInSolarSystem('?start=solar',''),'An explicit solar-system link opens the overview')
check(!startsInSolarSystem('','',true),'Guided launches retain their arrival')
for(const search of ['?site=malapert-massif','?t=1480','?journey=example','?c=1'])
  check(!startsInSolarSystem(search,''),`${search} keeps its bookmarked destination`)
check(!startsInSolarSystem('','#/validation'),'Validation bookmark keeps its destination')
for(const [tool] of WORKSPACE_TOOLS){
  check(initialWorkspacePanel(`?view=${tool}`,'')===tool,`${tool} deep link restores its panel`)
  check(!startsInSolarSystem(`?view=${tool}`,''),`${tool} does not inherit the new Start camera`)
  check(toggleWorkspacePanel(null,tool)===tool,`${tool} opens from the scene`)
  check(toggleWorkspacePanel(tool,tool)===null,`${tool} toggles closed`)
  for(const [other] of WORKSPACE_TOOLS) if(other!==tool) check(toggleWorkspacePanel(tool,other)===other,`${other} replaces ${tool}`)
}
check(!hasWorkspaceDrawer(null)&&!hasWorkspaceDrawer('selection'),'Site visit prompt leaves the full scene available')
check(hasWorkspaceDrawer('plan')&&hasWorkspaceDrawer('sites'),'Tools reserve space beside the live scene')
const look={yaw:0,pitch:0}
for(let i=0;i<12;i++)turnSiteLook(look,650,0)
check(look.yaw < -Math.PI*6,'Free look crosses north repeatedly without a heading stop')
for(let i=0;i<12;i++)turnSiteLook(look,-650,0)
check(Math.abs(look.yaw)<1e-12,'Turning back returns to the original bearing')
turnSiteLook(look,0,100000)
check(look.pitch===SITE_LOOK_PITCH_LIMIT&&look.pitch>89*Math.PI/180,'Look nearly straight up')
turnSiteLook(look,0,-200000)
check(look.pitch===-SITE_LOOK_PITCH_LIMIT&&look.pitch < -89*Math.PI/180,'Look down to the ground without a narrow vertical restriction')
console.log(`Single workspace and free-look checks passed: ${checks}`)
