import type { WorkspacePanel } from './workspace.ts'

// The question sent when the visitor presses "Ask Chader Buri" on a screen. Her screen
// digest travels with it, so she explains the numbers the visitor can actually see.
const QUESTIONS: Record<string, string> = {
  sites: 'What am I looking at in this list of mission sites, and which one should I explore first?',
  conditions: 'Explain these site conditions: what do the Sun and Earth numbers mean for a lander here?',
  plan: 'Explain this mission decision: what passes, what fails first, and why?',
  compare: 'Explain this comparison: which site suits our mission better, and why?',
  evidence: 'Where do these numbers come from? Explain the sources in simple words.',
  atlas: 'Explain this south-pole atlas: how are the sites ranked and what should I notice?',
  validation: 'What do these consistency checks prove, and what don’t they prove?',
  glossary: 'Which of these terms matter most when choosing a landing site?',
  surface: 'Explain what my visor is showing right now.',
  setup: 'Help me with the guided mission questions in plain words. Read my draft settings on screen; they have not been applied to the mission yet.',
  guide: 'Help me understand how to use this project. Explain one useful next step in plain words.',
  weather: 'Explain these dated NASA space-weather reports in plain words. Keep their current Earth dates separate from my selected mission date. Use only reports supplied on screen; do not infer a local radiation dose or a future landing forecast.',
}
export function panelQuestion(panel: WorkspacePanel | 'surface' | string | null): string {
  return (panel && QUESTIONS[panel]) || 'Explain what I’m looking at right now.'
}
