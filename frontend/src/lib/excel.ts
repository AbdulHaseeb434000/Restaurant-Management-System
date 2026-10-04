/**
 * Client-side Excel (.xlsx) export. exceljs is loaded lazily, only when someone exports.
 */
export type CellType = "text" | "number" | "money" | "qty" | "percent" | "date" | "datetime";
type CellValue = string | number | boolean | null | undefined;

export interface XCol<T> {
  header: string;
  value: (row: T) => CellValue;
  type?: CellType;
}

export interface XSheet<T = never> {
  name: string;
  columns: XCol<T>[];
  rows: T[];
}

const FORMATS: Partial<Record<CellType, string>> = {
  money: "#,##0.00",
  qty: "#,##0.###",
  number: "#,##0",
  percent: '0.00"%"',
  date: "dd-mmm-yyyy",
  datetime: "dd-mmm-yyyy hh:mm",
};

function toCell(v: CellValue, type: CellType | undefined): string | number | boolean | Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (type === "date" || type === "datetime") {
    const s = String(v);
    // plain yyyy-mm-dd dates are local calendar days; build them in UTC so Excel shows the same day
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    // Excel has no timezones: shift so the sheet shows the local wall-clock time
    return type === "datetime" ? new Date(d.getTime() - d.getTimezoneOffset() * 60000) : d;
  }
  if (type && type !== "text" && typeof v !== "number") {
    const n = Number(v);
    return Number.isNaN(n) ? String(v) : n;
  }
  return v;
}

export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportExcel(filename: string, sheets: XSheet<any>[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"), {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.header }));
    for (const row of sheet.rows) ws.addRow(sheet.columns.map((c) => toCell(c.value(row), c.type)));
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEA580C" } };
    header.alignment = { vertical: "middle" };
    sheet.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      const fmt = c.type ? FORMATS[c.type] : undefined;
      if (fmt) col.numFmt = fmt;
      // rough auto-width from the longest value
      let width = c.header.length;
      for (const row of sheet.rows.slice(0, 500)) {
        const v = c.value(row);
        width = Math.max(width, v === null || v === undefined ? 0 : String(v).length);
      }
      col.width = Math.min(Math.max(width + 2, c.type === "datetime" ? 18 : 10), 60);
    });
    if (sheet.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeFileName(filename)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
