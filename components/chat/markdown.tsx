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
    <div className="border-line my-4 overflow-hidden rounded-lg border bg-surface-hover">
      <div className="border-line flex h-9 items-center justify-between border-b pr-1.5 pl-3.5">
        <span className="text-fg-subtle font-mono text-[11px]">{language || "text"}</span>
        <button type="button" onClick={copy} className="btn btn-ghost h-6 gap-1 rounded-md px-2 text-[11px]">
          {copied ? <Check className="text-sage size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="text-fg overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-6">
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
    return <code className="bg-surface-raised border-line text-fg rounded-md border px-1.5 py-px font-mono text-[0.86em]">{children}</code>;
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
  ol: ({ children }) => <ol className="marker:text-fg-faint my-3 list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-[12px]">{children}</ol>,
  h1: ({ children }) => <h3 className="text-fg mt-6 mb-2 text-[15px] font-semibold tracking-[-0.01em]">{children}</h3>,
  h2: ({ children }) => <h3 className="text-fg mt-6 mb-2 text-[15px] font-semibold tracking-[-0.01em]">{children}</h3>,
  h3: ({ children }) => <h4 className="text-fg mt-5 mb-1.5 text-[14px] font-semibold">{children}</h4>,
  strong: ({ children }) => <strong className="text-fg font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="border-fg/40 text-fg-muted my-3 border-l-2 pl-4">{children}</blockquote>,
  hr: () => <hr className="border-line my-6" />,
};

/** Markdown for chat replies. Memoised so finished blocks don't re-parse on every streamed token. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <ReactMarkdown components={components}>{text}</ReactMarkdown>;
});
