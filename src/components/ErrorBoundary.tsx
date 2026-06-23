'use client'

/**
 * Reusable client-side error boundary. Wrap a self-contained widget so a
 * render-time throw inside it degrades to an inline error card instead of
 * white-screening the whole page — the siblings (and the app nav) stay
 * usable. React error boundaries must be class components.
 */

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Short label for the fallback copy + console, e.g. "email review". */
  label?: string
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Surface in logs; the UI already shows the message.
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="border border-chip-bad-fg/30 bg-chip-bad-bg/30 rounded-xl p-4 text-sm">
          <div className="font-semibold text-chip-bad-fg">
            Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.
          </div>
          <div className="text-xs text-lt-fg2 mt-1 break-words">{this.state.error.message}</div>
          <button
            type="button"
            onClick={this.reset}
            className="mt-2 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
