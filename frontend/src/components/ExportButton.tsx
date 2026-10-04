"use client";

import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { exportExcel, XSheet } from "@/lib/excel";
import { isoDate } from "@/lib/format";
import { useToast } from "./ui";

/** "Excel" button: builds the sheets lazily on click and downloads an .xlsx file. */
export default function ExportButton({
  filename,
  sheets,
  disabled,
}: {
  filename: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: () => XSheet<any>[];
  disabled?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const s = sheets();
      if (!s.some((x) => x.rows.length)) {
        toast("Nothing to export", "info");
        return;
      }
      await exportExcel(`${filename}_${isoDate()}`, s);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn-secondary" onClick={run} disabled={disabled || busy} title="Export to Excel">
      {busy ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} className="text-emerald-600" />} Excel
    </button>
  );
}
