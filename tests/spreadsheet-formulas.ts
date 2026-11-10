/**
 * PHASE 3 / Task 4 (2026-11-09) — spreadsheet formulas are preserved.
 *
 * A formula is the student's method. Reading only the computed value hid the
 * reasoning they were asked to quote, so formulas are now rendered as
 * "=formula → value" and the note says exactly that.
 *
 * This test builds real .xlsx bytes in memory, so it exercises the actual
 * parser rather than a stub.
 */
import { parseSpreadsheet, parseCsv } from "../src/lib/extract/documents";

export async function runSpreadsheetFormulaTests(
  assert: (cond: boolean, name: string) => void,
  section: (title: string) => void,
): Promise<void> {
  section("spreadsheets: the formula survives, not just its result");

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Item", "Units", "Price", "Total"],
    ["Widget", 3, 4, { t: "n", f: "B2*C2", v: 12 }],
    ["Gadget", 2, 5, { t: "n", f: "B3*C3", v: 10 }],
    ["Sum", "", "", { t: "n", f: "SUM(D2:D3)", v: 22 }],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Costs");
  const bytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);

  const out = await parseSpreadsheet(bytes);

  assert(out.text.includes("=B2*C2"), "a multiplication formula appears in the extracted text");
  assert(out.text.includes("12"), "and its computed value is kept beside it");
  assert(out.text.includes("=SUM(D2:D3)"), "a SUM formula is preserved, including its range");
  assert(out.text.includes("Widget") && out.text.includes("Gadget"), "the data around the formulas is still read");
  assert(out.text.includes("## Sheet: Costs"), "the sheet name is preserved");
  assert(/shown as "=formula → computed value"/.test(out.notes), "the note explains how formulas are presented");
  assert(!/not shown/.test(out.notes), "the old 'formulas are not shown' caveat is gone, because they are shown");

  // A sheet without formulas must not claim any.
  const plainWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(plainWb, XLSX.utils.aoa_to_sheet([["a", 1], ["b", 2]]), "Plain");
  const plainBytes = Buffer.from(XLSX.write(plainWb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
  const plain = await parseSpreadsheet(plainBytes);
  assert(/No formulas were found/.test(plain.notes), "a formula-free workbook is described accurately");
  assert(!/→/.test(plain.text), "no arrow artefacts appear when there are no formulas");

  // CSV has no formulas to invent.
  const csv = parseCsv("a,b\n1,2\n");
  assert(!/→/.test(csv.text), "CSV extraction does not fabricate formulas");
  assert(csv.text.includes("a") && csv.text.includes("1"), "CSV data is read as-is");

  // A formula whose cached value is missing still shows the formula.
  const noValueWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(noValueWb, XLSX.utils.aoa_to_sheet([["x"], [{ t: "n", f: "1+1" }]]), "Bare");
  const bareBytes = Buffer.from(XLSX.write(noValueWb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
  const bare = await parseSpreadsheet(bareBytes);
  assert(bare.text.includes("=1+1"), "a formula with no cached value is shown rather than blanked");
}
