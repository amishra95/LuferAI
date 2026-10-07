"use client";

import { Component, type ReactNode } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

/**
 * Contains a render error to one panel so the rest of the page keeps working.
 * Retry remounts the children.
 */
export class PanelErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`${this.props.label} crashed`, error);
  }

  render() {
    if (!this.state.error) return <div key={this.state.attempt}>{this.props.children}</div>;
    return <ErrorFallback title={`${this.props.label} couldn't be displayed`} message={this.state.error.message} onRetry={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))} />;
  }
}

export function ErrorFallback({ title, message, onRetry }: { title: string; message?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="panel flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
      <span className="bg-rose/10 grid size-8 shrink-0 place-items-center rounded-full">
        <TriangleAlert className="text-rose size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-fg text-[13.5px] font-medium">{title}</p>
        {message && <p className="text-fg-subtle mt-0.5 font-mono text-[11.5px] break-words">{message}</p>}
      </div>
      <button type="button" onClick={onRetry} className="btn shrink-0">
        <RotateCw className="size-3.5" aria-hidden /> Try again
      </button>
    </div>
  );
}
