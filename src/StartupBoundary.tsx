import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Keep a rejected app import or render failure from turning Start into an empty screen. */
export class StartupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Explorer startup failed:', error, info.componentStack)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <section role="alert" aria-labelledby="startup-failure-title" style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24, background: '#000', color: '#fafafa' }}>
      <div style={{ maxWidth: 420, lineHeight: 1.6 }}>
        <h1 id="startup-failure-title" style={{ fontSize: 24, fontWeight: 600 }}>The explorer could not open</h1>
        <p style={{ margin: '12px 0 20px', color: '#c7c7ce' }}>Reload to try again. Reloading does not clear your browser’s saved mission or conversation.</p>
        <button onClick={() => window.location.reload()} style={{ minHeight: 44, padding: '10px 16px', borderRadius: 8, background: '#fafafa', color: '#000', fontWeight: 600 }}>Reload explorer</button>
      </div>
    </section>
  }
}
