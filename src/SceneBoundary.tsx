import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * A graphics/asset failure must not take the scientific planner down with it. This boundary only catches: it logs
 * the original error with its component stack and hands it to the app, which unmounts the failed scene (disposing
 * its WebGL context) and shows the failure state above the 3D controls. It renders nothing once it has failed.
 */
export class SceneBoundary extends Component<{ children: ReactNode; onFailure: (error: unknown, componentStack?: string) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('3D view failed:', error, info.componentStack)
    this.props.onFailure(error, info.componentStack ?? undefined)
  }
  render() { return this.state.failed ? null : this.props.children }
}
