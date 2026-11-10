/**
 * STRUCTURED TEXT FROM HTML, WITHOUT REGULAR EXPRESSIONS (2026-11-09)
 *
 * `src/lib/extract/documents.ts` used a chain of regex replacements to turn
 * mammoth's HTML into text. Two problems, both real:
 *
 *   1. Regex tag-stripping is a bypass class (`</script >`, `<img/src=x>`,
 *      unterminated tags). CodeQL alerts #19/#18/#17.
 *   2. Replacements that decode entities decode their own output, so
 *      `&amp;lt;script&amp;gt;` becomes live-looking markup. Alerts #15/#14.
 *
 * This module reads the markup once, into a small tree, and renders text from the
 * tree. Nothing is ever emitted as markup, entities are decoded exactly once, and
 * document structure (headings, ordered and unordered lists, tables, paragraphs)
 * survives - which is the whole point of the extractor.
 *
 * Deliberately not a browser-grade HTML parser: no scripting, no error recovery
 * beyond closing unclosed elements at the end, no network, no dependencies. It is
 * a text extractor for documents we already trust structurally (mammoth output),
 * and it treats every character as data.
 */

import { decodeHtmlEntities } from "./entities";

type Node = { text: string } | Element;

interface Element {
  name: string;
  children: Node[];
}

/** Elements with no content and no closing tag. */
const VOID_ELEMENTS = new Set(["br", "hr", "img", "meta", "link", "input", "wbr", "col", "source", "area", "base", "embed", "param", "track"]);
/** Elements whose content is never document text. */
const SKIPPED_ELEMENTS = new Set(["script", "style", "noscript", "template", "head", "title"]);
/** Elements that only group other blocks. */
const TRANSPARENT_BLOCKS = new Set(["html", "body", "div", "section", "article", "main", "header", "footer", "blockquote", "figure", "figcaption", "td", "th"]);

const BLOCK_ELEMENTS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead",
  "tbody", "tr", "pre", "hr", "br", "div", "section", "article", "main", "body",
  "header", "footer", "blockquote", "figure", "figcaption",
]);

function isNameStart(ch: string): boolean {
  return /[a-z]/i.test(ch);
}

function isNameChar(ch: string): boolean {
  return /[a-z0-9:_-]/i.test(ch);
}

/** Index of the `>` closing the tag that starts at `lt`, ignoring `>` inside quotes. */
function tagEnd(html: string, lt: number): number {
  let quote: string | null = null;
  for (let i = lt + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}

/**
 * Parses markup into a node tree. Unclosed elements are closed at the end, stray
 * closing tags are ignored, comments and skipped elements never enter the tree.
 */
function parse(html: string): Node[] {
  const root: Element = { name: "#root", children: [] };
  const stack: Element[] = [root];
  let i = 0;

  const push = (node: Node) => stack[stack.length - 1].children.push(node);

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      push({ text: html.slice(i) });
      break;
    }
    if (lt > i) push({ text: html.slice(i, lt) });

    // Comment / declaration / processing instruction
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const next = html[lt + 1] ?? "";
    if (!isNameStart(next) && next !== "/") {
      const end = tagEnd(html, lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const end = tagEnd(html, lt);
    if (end === -1) {
      // A "<" that never closes is text, not a tag.
      push({ text: html.slice(lt) });
      break;
    }
    const raw = html.slice(lt + 1, end);
    i = end + 1;

    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let depth = stack.length - 1; depth >= 1; depth--) {
        if (stack[depth].name === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    let cursor = 0;
    while (cursor < raw.length && isNameChar(raw[cursor])) cursor++;
    const name = raw.slice(0, cursor).toLowerCase();
    const selfClosing = raw.trimEnd().endsWith("/");

    if (SKIPPED_ELEMENTS.has(name)) {
      // Skip to the matching close tag, tolerating whitespace and attributes.
      const closePattern = new RegExp(`</\\s*${name}(?:\\s[^>]*)?>`, "i");
      const rest = html.slice(i);
      const found = closePattern.exec(rest);
      i = found ? i + found.index + found[0].length : html.length;
      continue;
    }

    const element: Element = { name, children: [] };
    push(element);
    if (VOID_ELEMENTS.has(name) || selfClosing) continue;
    stack.push(element);
  }

  return root.children;
}

/** Collapses inline whitespace to single spaces. */
function collapse(text: string): string {
  return text.replace(/[ \t\r\n\f\v]+/g, " ");
}

/** Text inside an element, decoded once, with inline breaks as spaces. */
function inlineText(element: Element): string {
  let out = "";
  for (const child of element.children) {
    if ("text" in child) {
      out += decodeHtmlEntities(child.text);
      continue;
    }
    if (SKIPPED_ELEMENTS.has(child.name)) continue;
    if (child.name === "br") {
      out += " ";
      continue;
    }
    out += inlineText(child);
  }
  return collapse(out).trim();
}

function hasBlockChild(element: Element): boolean {
  return element.children.some((child) => !("text" in child) && BLOCK_ELEMENTS.has(child.name));
}

/** Renders list items, numbering ordered lists from 1. */
function renderList(element: Element, ordered: boolean): string {
  let index = 1;
  const lines: string[] = [];
  for (const child of element.children) {
    if ("text" in child) {
      const text = collapse(decodeHtmlEntities(child.text)).trim();
      if (text) lines.push(`${ordered ? `${index++}.` : "-"} ${text}`);
      continue;
    }
    if (child.name !== "li") {
      const nested = renderBlock(child);
      if (nested) lines.push(nested.trimEnd());
      continue;
    }
    const nestedList = child.children.find((c): c is Element => !("text" in c) && (c.name === "ul" || c.name === "ol"));
    const nested = child.children.filter((c) => c !== nestedList);
    const text = collapse(nested.map((c) => ("text" in c ? decodeHtmlEntities(c.text) : inlineText(c))).join(" ")).trim();
    if (text) lines.push(`${ordered ? `${index++}.` : "-"} ${text}`);
    if (nestedList) {
      const inner = renderList(nestedList, nestedList.name === "ol");
      if (inner) lines.push(inner.trimEnd().split("\n").map((line) => `  ${line}`).join("\n"));
    }
  }
  return lines.join("\n");
}

/** Renders a table as pipe-separated rows, first row first, header row kept. */
function renderTable(element: Element): string {
  const rows: string[] = [];
  const walk = (node: Element) => {
    for (const child of node.children) {
      if ("text" in child) continue;
      if (child.name === "tr") {
        const cells: string[] = [];
        for (const cell of child.children) {
          if ("text" in cell || (cell.name !== "td" && cell.name !== "th")) continue;
          cells.push(inlineText(cell));
        }
        if (cells.some(Boolean)) rows.push(`| ${cells.join(" | ")} |`);
        continue;
      }
      walk(child);
    }
  };
  walk(element);
  return rows.join("\n");
}

function renderBlock(node: Node): string {
  if ("text" in node) {
    const text = collapse(decodeHtmlEntities(node.text)).trim();
    return text ? `${text}\n` : "";
  }
  const name = node.name;

  if (SKIPPED_ELEMENTS.has(name)) return "";

  if (/^h[1-6]$/.test(name)) {
    const level = Number(name[1]);
    const text = inlineText(node);
    return text ? `${"#".repeat(level)} ${text}\n\n` : "";
  }
  if (name === "p") {
    const text = inlineText(node);
    return text ? `${text}\n\n` : "";
  }
  if (name === "ul" || name === "ol") {
    const list = renderList(node, name === "ol");
    return list ? `${list}\n\n` : "";
  }
  if (name === "table") {
    const table = renderTable(node);
    return table ? `${table}\n\n` : "";
  }
  if (name === "pre") {
    const text = inlineText(node);
    return text ? `${text}\n\n` : "";
  }
  if (name === "hr") return "---\n\n";
  if (name === "br") return "\n";
  if (TRANSPARENT_BLOCKS.has(name) || hasBlockChild(node)) {
    return node.children.map(renderBlock).join("");
  }
  // A bare inline element at block level still contributes its text.
  const text = inlineText(node);
  return text ? `${text}\n` : "";
}

/**
 * Converts document HTML to structured plain text.
 *
 * Headings become Markdown headings, list items keep their markers, table rows are
 * pipe-separated, and paragraphs stay separate. Content is plain text: any `<` or
 * `>` in the source arrives as a character, never as markup.
 */
export function htmlToStructuredText(html: string): string {
  if (!html) return "";
  const nodes = parse(html);
  const rendered = nodes.map(renderBlock).join("");
  return rendered
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Single line of plain text from an HTML fragment (used for titles and cells). */
export function htmlInlineText(html: string): string {
  if (!html) return "";
  const nodes = parse(html);
  return collapse(nodes.map((node) => ("text" in node ? decodeHtmlEntities(node.text) : inlineText(node))).join(" "))
    .trim();
}
