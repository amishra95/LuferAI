"use client";

import { isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { remarkBreaks } from "./remark-breaks";
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
    <div className="border-line my-4 overflow-hidden rounded-lg border bg-surface-hover">
      <div className="border-line flex h-9 items-center justify-between border-b pr-1.5 pl-3.5">
        <span className="text-fg-subtle font-mono text-caption">{language || "text"}</span>
        <button type="button" onClick={copy} className="btn btn-ghost h-6 gap-1 rounded-md px-2 text-caption">
          {copied ? <Check className="text-sage size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="text-fg overflow-x-auto px-4 py-3.5 font-code text-meta leading-6">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// GitHub-flavoured markdown: pipe tables, strikethrough, task lists, autolinks.
const remarkPlugins = [remarkGfm, remarkBreaks];

const components: Components = {
  pre({ children }) {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
    const language = code?.props.className?.match(/language-([\w+-]+)/)?.[1] ?? "";
    return <CodeBlock language={language} code={textOf(code?.props.children ?? children).replace(/\n$/, "")} />;
  },
  code({ children }) {
    return <code className="bg-surface-raised border-line text-fg rounded-md border px-1.5 py-px font-code text-[0.86em]">{children}</code>;
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-fg decoration-fg/50 underline underline-offset-[3px] hover:decoration-fg">
        {children}
      </a>
    );
  },
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="marker:text-fg-faint my-3 list-disc space-y-1.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="marker:text-fg-faint my-3 list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-caption">{children}</ol>,
  h1: ({ children }) => <h3 className="text-fg mt-6 mb-2 text-body font-semibold tracking-[-0.01em]">{children}</h3>,
  h2: ({ children }) => <h3 className="text-fg mt-6 mb-2 text-body font-semibold tracking-[-0.01em]">{children}</h3>,
  h3: ({ children }) => <h4 className="text-fg mt-5 mb-1.5 text-body font-semibold">{children}</h4>,
  strong: ({ children }) => <strong className="text-fg font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="border-fg/40 text-fg-muted my-3 border-l-2 pl-4">{children}</blockquote>,
  hr: () => <hr className="border-line my-6" />,
  // Wide tables scroll inside their frame instead of widening the chat column.
  table: ({ children }) => (
    <div className="border-line my-4 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-left text-meta leading-5 tabular-nums">{children}</table>
    </div>
  ),
  // Dark palette (app/globals.css): raised header, striped body rows, hover on the row under the pointer.
  thead: ({ children }) => <thead className="bg-surface-raised border-line border-b">{children}</thead>,
  tbody: ({ children }) => <tbody className="[&>tr:nth-child(even):not(:hover)]:bg-surface [&>tr:hover]:bg-surface-hover">{children}</tbody>,
  tr: ({ children }) => <tr className="border-line border-b transition-colors last:border-b-0">{children}</tr>,
  th: ({ children, style }) => (
    <th style={style} className="text-fg px-3 py-2 align-bottom font-semibold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="text-fg-muted px-3 py-2 align-top">
      {children}
    </td>
  ),
};

/** Markdown for chat replies. Memoised so finished blocks don't re-parse on every streamed token. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
});
