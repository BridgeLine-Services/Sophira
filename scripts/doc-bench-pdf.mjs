#!/usr/bin/env node
// SYNTHETIC PDF benchmark (Prompt 3). Writer: pdf-lib, devDependency only.
const { PDFDocument, StandardFonts } = await import("pdf-lib");
const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;

const rows = [];
const norm = (t) => t.replace(/\s+/g, " ").trim();
const recall = (t, toks) => ({ tokens: toks.filter((k) => t.includes(k)).length + "/" + toks.length });

async function build(lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const l of lines) page.drawText(l.text, { x: l.x ?? 60, y: l.y, size: l.size ?? 12, font });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const cases = [
  ["text + heading", [{ text: "Photosynthesis in Plants", y: 740, size: 16 },
    { text: "Chlorophyll absorbs light in the thylakoid.", y: 710 },
    { text: "Mitochondria perform respiration.", y: 690 }],
    ["Photosynthesis", "Chlorophyll", "Mitochondria"]],
  ["table 3x3", (() => {
    const r = [["Term", "Value", "Unit"], ["Mass", "12", "kg"], ["Velocity", "3", "m/s"]];
    const out = []; r.forEach((row, i) => row.forEach((c, j) => out.push({ text: c, x: 60 + j * 150, y: 720 - i * 20 })));
    return out; })(), ["Mass", "Velocity", "m/s"]],
  ["two columns", (() => {
    const out = []; ["Left one", "Left two", "Left three"].forEach((t, i) => out.push({ text: t, x: 60, y: 700 - i * 20 }));
    ["Right one", "Right two", "Right three"].forEach((t, i) => out.push({ text: t, x: 330, y: 700 - i * 20 }));
    return out; })(), ["Left one", "Right three"]],
  ["equations (WinAnsi-safe)", [{ text: "Equation: E = mc^2", y: 720 }, { text: "Identity: a^2 + b^2 = c^2", y: 700 }],
    ["E = mc^2", "a^2 + b^2 = c^2"]],
];

for (const [name, lines, toks] of cases) {
  try {
    const t = norm((await pdfParse(await build(lines))).text);
    const extra = name === "two columns"
      ? (t.indexOf("Left three") < t.indexOf("Right one") ? "columns kept separate" : "COLUMNS INTERLEAVED")
      : name === "table 3x3" ? ("row adjacency kept=" + /Term\s+Value/.test(t)) : "";
    rows.push({ format: "PDF synthetic: " + name, chars: t.length, ...recall(t, toks), notes: extra });
  } catch (e) { rows.push({ format: "PDF synthetic: " + name, error: String(e.message).slice(0, 60) }); }
}

try {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 80, y: 600, width: 400, height: 120 });
  const t = norm((await pdfParse(Buffer.from(await doc.save({ useObjectStreams: false })))).text);
  rows.push({ format: "PDF synthetic: scanned (no text layer)", chars: t.length, tokens: "n/a",
    notes: "0 chars = correct; the route must signal low confidence, not 'extracted'" });
} catch (e) { rows.push({ format: "PDF synthetic: scanned", error: String(e.message).slice(0, 60) }); }

console.table(rows);
