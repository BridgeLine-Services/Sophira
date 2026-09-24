import type { ReactNode } from "react";

/**
 * Minimal, dependency-free markdown renderer for AI results.
 * Supports: headings, paragraphs, bold, italic, inline code, fenced code,
 * ordered/unordered lists, horizontal rules, and simple pipe tables.
 * Rendered inside a container with class "result-body" (styled in globals.css).
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // split on code spans first so nothing else is processed inside them
  const codeParts = text.split(/(`[^`]+`)/g);
  codeParts.forEach((cp, i) => {
    if (i % 2 === 1) {
      out.push(<code key={`${keyPrefix}-c${i}`}>{cp.slice(1, -1)}</code>);
      return;
    }
    // bold + italic
    const parts = cp.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    parts.forEach((p, j) => {
      if (!p) return;
      const k = `${keyPrefix}-${i}-${j}`;
      if (p.startsWith("**") && p.endsWith("**")) {
        out.push(<strong key={k}>{p.slice(2, -2)}</strong>);
      } else if (p.startsWith("*") && p.endsWith("*")) {
        out.push(<em key={k}>{p.slice(1, -1)}</em>);
      } else {
        out.push(<span key={k}>{p}</span>);
      }
    });
  });
  return out;
}

export function ResultBody({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(<pre key={key++}><code>{buf.join("\n")}</code></pre>);
      continue;
    }

    // heading
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const Tag = (["h1", "h2", "h3"] as const)[h[1].length - 1];
      blocks.push(<Tag key={key++}>{inline(h[2], `h${key}`)}</Tag>);
      i++;
      continue;
    }

    // hr
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-4 border-ink/10" />);
      i++;
      continue;
    }

    // table
    if (line.includes("|") && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = line.split("|").map((c) => c.trim()).filter((c, idx, arr) => !(c === "" && (idx === 0 || idx === arr.length - 1)));
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(lines[i].split("|").map((c) => c.trim()).filter((c, idx, arr) => !(c === "" && (idx === 0 || idx === arr.length - 1))));
        i++;
      }
      blocks.push(
        <table key={key++}>
          <thead>
            <tr>{header.map((c, ci) => <th key={ci}>{inline(c, `th${ci}`)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `td${ri}-${ci}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(<ul key={key++}>{items.map((it, ii) => <li key={ii}>{inline(it, `li${ii}`)}</li>)}</ul>);
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(<ol key={key++}>{items.map((it, ii) => <li key={ii}>{inline(it, `oli${ii}`)}</li>)}</ol>);
      continue;
    }

    // paragraph
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+[.)]|#{1,3}\s|```)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++}>{inline(buf.join(" "), `p${key}`)}</p>);
  }

  return <div className="result-body">{blocks}</div>;
}
