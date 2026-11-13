import { initialWorkspacePanel } from './lib/workspace'

// A named tool or saved mission link is an explicit destination.
export function startsWithMoonWalk() {
  const { search, hash } = window.location
  return !initialWorkspacePanel(search, hash) && !new URLSearchParams(search).has('journey')
}

