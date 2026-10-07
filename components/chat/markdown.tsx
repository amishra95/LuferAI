"use client";

import { isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Check, Copy } from "lucide-react";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure context, permissions); nothing useful to show.
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="font-mono text-[11px] text-zinc-500">{language || "text"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  pre({ children }) {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
    const language = code?.props.className?.match(/language-([\w+-]+)/)?.[1] ?? "";
    return <CodeBlock language={language} code={textOf(code?.props.children ?? children).replace(/\n$/, "")} />;
  },
  code({ children }) {
    return <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[0.85em] text-zinc-100">{children}</code>;
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-sky-400 underline-offset-2 hover:underline">
        {children}
      </a>
    );
  },
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-zinc-600">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-zinc-600">{children}</ol>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-base font-semibold text-zinc-50">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 text-base font-semibold text-zinc-50">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold text-zinc-50">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-zinc-700 pl-3 text-zinc-400">{children}</blockquote>,
};

/** Markdown for chat bubbles. Memoised so finished blocks don't re-parse on every streamed token. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <ReactMarkdown components={components}>{text}</ReactMarkdown>;
});
