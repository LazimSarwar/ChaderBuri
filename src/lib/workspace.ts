export type WorkspacePanel = 'selection' | 'sites' | 'conditions' | 'plan' | 'compare' | 'evidence' | 'atlas' | 'validation' | 'glossary' | 'setup' | 'guide' | 'weather' | null
export const WORKSPACE_TOOLS = [
  ['sites','Mission sites'], ['conditions','Site conditions'], ['plan','Mission planning'],
  ['compare','Compare sites'], ['evidence','Sources & methods'], ['atlas','South-pole atlas'],
  ['validation','Consistency checks'], ['glossary','Glossary'],
  ['setup','Plan with help'], ['guide','How to use'], ['weather','Space weather'],
] as const
export function initialWorkspacePanel(search: string, hash: string): WorkspacePanel {
  if(hash === '#/validation') return 'validation'
  const params = new URLSearchParams(search), view = params.get('view')
  if(WORKSPACE_TOOLS.some(([key])=>key===view)) return view as WorkspacePanel
  return params.get('c') === '1' ? 'compare' : null
}
// An ordinary Start opens on the Moon, where the landing-site work happens. The full solar-system
// overview is one click away, or opens directly with ?start=solar. Bookmarks keep their destination.
export function startsInSolarSystem(search: string, hash: string, guidedLaunch = false): boolean {
  const params = new URLSearchParams(search)
  return !guidedLaunch && initialWorkspacePanel(search, hash) === null && params.get('start') === 'solar' &&
    !['site', 't', 'journey'].some(key => params.has(key))
}
export function toggleWorkspacePanel(current: WorkspacePanel, requested: Exclude<WorkspacePanel,null>): WorkspacePanel {
  return current === requested ? null : requested
}
export const hasWorkspaceDrawer = (panel: WorkspacePanel): boolean => panel !== null && panel !== 'selection'
