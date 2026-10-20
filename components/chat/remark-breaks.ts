/**
 * Models write `<br>` for a line break inside a table cell, where markdown has
 * no other way to make one. Raw HTML stays off in chat (it's shown as text), so
 * only a bare <br> becomes a real line break.
 *
 * Pure, with no imports, so tests/chat-markdown.test.mjs can load it directly.
 */
type MdNode = { type: string; value?: string; children?: MdNode[] };

const BR = /^<br\s*\/?>$/i;

export function remarkBreaks() {
  const walk = (node: MdNode) => {
    node.children = node.children?.map((child) => (child.type === "html" && BR.test(child.value?.trim() ?? "") ? { type: "break" } : (walk(child), child)));
  };
  return (tree: MdNode) => walk(tree);
}
