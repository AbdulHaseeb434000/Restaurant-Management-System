"use client";

import { Eye, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import LineEditor, { EditableLine, validLines } from "@/components/LineEditor";
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { dateOnly, daysAgo, isoDate, money, qty } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { InventoryItem, StockIssue } from "@/lib/types";

export default function IssuesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Issues />
    </Suspense>
  );
}

function Issues() {
  const toast = useToast();
  const params = useSearchParams();
  const [dateFrom, setDateFrom] = useState(daysAgo(7));
  const [dateTo, setDateTo] = useState(isoDate());
  const { data, error, reload } = useApi<StockIssue[]>("/inventory/issues", { date_from: dateFrom, date_to: dateTo });
  const { data: items, reload: reloadItems } = useApi<InventoryItem[]>("/inventory/items");
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<StockIssue | null>(null);

  const [date, setDate] = useState(isoDate());
  const [issuedTo, setIssuedTo] = useState("Main Kitchen");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    setDate(isoDate());
    setNotes("");
    setLines([{ item_id: "", quantity: "" }]);
    setCreating(true);
  };

  useEffect(() => {
    if (params.get("new") === "1") openNew();
  }, [params]);

  const save = async () => {
    const payload = validLines(lines);
    if (!payload.length) return toast("Add at least one line with quantity", "error");
    setBusy(true);
    try {
      const r = await api.post<StockIssue>("/inventory/issues", { issue_date: date, issued_to: issuedTo, notes, items: payload });
      toast(`${r.issue_no} saved - stock moved to kitchen`);
      setCreating(false);
      reload();
      reloadItems();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const total = (data ?? []).reduce((s, i) => s + i.total_value, 0);

  return (
    <div>
      <PageHeader title="Store → Kitchen Issues" subtitle={`${data?.length ?? 0} issues · ${money(total)} issued`} actions={<button className="btn-primary" onClick={openNew}><Plus size={16} /> New issue</button>} />
      <div className="card mb-4 flex flex-wrap gap-3 p-3">
        <input className="input w-auto" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From" />
        <input className="input w-auto" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To" />
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty message="No issues in this period." /> : (
          <table className="table-base">
            <thead><tr><th>Issue #</th><th>Date</th><th>Issued to</th><th className="text-right">Lines</th><th className="text-right">Value</th><th>By</th><th /></tr></thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.issue_no}</td>
                  <td>{dateOnly(i.issue_date)}</td>
                  <td>{i.issued_to}</td>
                  <td className="text-right">{i.items.length}</td>
                  <td className="text-right">{money(i.total_value)}</td>
                  <td>{i.created_by_name ?? "-"}</td>
                  <td className="text-right"><button className="btn-ghost btn-sm" aria-label="View" onClick={() => setView(i)}><Eye size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Issue stock from store to kitchen" size="xl" footer={<><button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>Issue stock</button></>}>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Issued to"><input className="input" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} /></Field>
          <Field label="Notes"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <LineEditor items={(items ?? []).filter((i) => i.store_qty > 0)} lines={lines} onChange={setLines} showStore />
        <p className="mt-2 text-xs text-slate-500">Only items with store stock are listed. Items are valued at weighted-average cost.</p>
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={`${view?.issue_no ?? ""} - ${view?.issued_to ?? ""}`} size="lg">
        {view && (
          <div className="space-y-3 text-sm">
            <div>{dateOnly(view.issue_date)} · by {view.created_by_name ?? "-"} {view.notes && `· ${view.notes}`}</div>
            <table className="table-base">
              <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Value</th></tr></thead>
              <tbody>
                {view.items.map((l) => (
                  <tr key={l.id}><td>{l.item_name}</td><td className="text-right">{qty(l.quantity)} {l.unit_name}</td><td className="text-right">{money(l.unit_cost)}</td><td className="text-right">{money(l.line_total)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="text-right">Total value <b>{money(view.total_value)}</b></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
