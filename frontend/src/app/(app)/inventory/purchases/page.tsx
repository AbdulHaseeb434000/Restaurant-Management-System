"use client";

import { Ban, Eye, Plus, Wallet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import LineEditor, { EditableLine, validLines } from "@/components/LineEditor";
import { Empty, ErrorBox, Field, Modal, PageHeader, PromptDialog, Spinner, StatusBadge, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { dateOnly, daysAgo, isoDate, money, qty } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { InventoryItem, Purchase, Supplier } from "@/lib/types";

export default function PurchasesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Purchases />
    </Suspense>
  );
}

function Purchases() {
  const toast = useToast();
  const params = useSearchParams();
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo, setDateTo] = useState(isoDate());
  const [supplierId, setSupplierId] = useState("");
  const { data, error, reload } = useApi<Purchase[]>("/inventory/purchases", { date_from: dateFrom, date_to: dateTo, supplier_id: supplierId || undefined });
  const { data: suppliers } = useApi<Supplier[]>("/inventory/suppliers");
  const { data: items, reload: reloadItems } = useApi<InventoryItem[]>("/inventory/items");

  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState<Purchase | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [paid, setPaid] = useState("");

  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const total = (data ?? []).filter((p) => p.status === "received").reduce((s, p) => s + p.total, 0);
  const due = (data ?? []).filter((p) => p.status === "received").reduce((s, p) => s + p.total - p.paid_amount, 0);

  return (
    <div>
      <PageHeader
        title="Purchases (Goods Received)"
        subtitle={`${data?.length ?? 0} purchases · ${money(total)} total · ${money(due)} unpaid`}
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New purchase</button>}
      />
      <div className="card mb-4 flex flex-wrap gap-3 p-3">
        <input className="input w-auto" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From" />
        <input className="input w-auto" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To" />
        <select className="input w-auto" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
          <option value="">All suppliers</option>
          {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty message="No purchases in this period." /> : (
          <table className="table-base">
            <thead><tr><th>GRN #</th><th>Date</th><th>Supplier</th><th>Invoice</th><th className="text-right">Lines</th><th className="text-right">Total</th><th className="text-right">Paid</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.purchase_no}</td>
                  <td>{dateOnly(p.purchase_date)}</td>
                  <td>{p.supplier_name}</td>
                  <td>{p.invoice_no || "-"}</td>
                  <td className="text-right">{p.items.length}</td>
                  <td className="text-right">{money(p.total)}</td>
                  <td className={`text-right ${p.paid_amount < p.total ? "text-red-600" : ""}`}>{money(p.paid_amount)}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" aria-label="View" onClick={() => setView(p)}><Eye size={14} /></button>
                    {p.status === "received" && (
                      <>
                        <button className="btn-ghost btn-sm" title="Record payment" onClick={() => { setPaid(String(p.total)); setPaying(p); }}><Wallet size={14} /></button>
                        <button className="btn-ghost btn-sm text-red-600" title="Cancel" onClick={() => setCancelling(p)}><Ban size={14} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <NewPurchase
        open={creating}
        suppliers={(suppliers ?? []).filter((s) => s.is_active)}
        items={items ?? []}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          reload();
          reloadItems();
        }}
      />

      <Modal open={!!view} onClose={() => setView(null)} title={`${view?.purchase_no ?? ""} - ${view?.supplier_name ?? ""}`} size="lg">
        {view && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><span className="label">Date</span>{dateOnly(view.purchase_date)}</div>
              <div><span className="label">Invoice</span>{view.invoice_no || "-"}</div>
              <div><span className="label">Received by</span>{view.created_by_name ?? "-"}</div>
              <div><span className="label">Status</span><StatusBadge status={view.status} /></div>
            </div>
            <table className="table-base">
              <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {view.items.map((l) => (
                  <tr key={l.id}><td>{l.item_name}</td><td className="text-right">{qty(l.quantity)} {l.unit_name}</td><td className="text-right">{money(l.unit_cost)}</td><td className="text-right">{money(l.line_total)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="text-right">Total <b>{money(view.total)}</b> · Paid {money(view.paid_amount)} · Due <b>{money(view.total - view.paid_amount)}</b></div>
            {view.notes && <p className="whitespace-pre-wrap text-slate-600">{view.notes}</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!paying} onClose={() => setPaying(null)} title={`Payment for ${paying?.purchase_no ?? ""}`} size="sm"
        footer={<button className="btn-primary" onClick={async () => {
          try {
            await api.post(`/inventory/purchases/${paying!.id}/payment`, { paid_amount: parseFloat(paid) || 0 });
            toast("Payment updated");
            setPaying(null);
            reload();
          } catch (e) { toast((e as Error).message, "error"); }
        }}>Save</button>}>
        <p className="mb-2 text-sm text-slate-500">Total {money(paying?.total)}. Enter the total amount paid to the supplier so far.</p>
        <input className="input" type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} />
      </Modal>

      <PromptDialog
        open={!!cancelling}
        title={`Cancel ${cancelling?.purchase_no ?? ""}`}
        message="Stock received on this purchase will be removed from the store. This fails if the stock was already issued."
        requireText danger confirmText="Cancel purchase"
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          try {
            await api.post(`/inventory/purchases/${cancelling!.id}/cancel`, { reason });
            toast("Purchase cancelled");
            setCancelling(null);
            reload();
            reloadItems();
          } catch (e) { toast((e as Error).message, "error"); }
        }}
      />
    </div>
  );
}

function NewPurchase({ open, suppliers, items, onClose, onSaved }: { open: boolean; suppliers: Supplier[]; items: InventoryItem[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [date, setDate] = useState(isoDate());
  const [invoice, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [paid, setPaid] = useState("0");
  const [lines, setLines] = useState<EditableLine[]>([{ item_id: "", quantity: "", unit_cost: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSupplierId("");
      setDate(isoDate());
      setInvoice("");
      setNotes("");
      setPaid("0");
      setLines([{ item_id: "", quantity: "", unit_cost: "" }]);
    }
  }, [open]);

  const save = async () => {
    const payload = validLines(lines, true);
    if (!supplierId) return toast("Select a supplier", "error");
    if (!payload.length) return toast("Add at least one line with quantity", "error");
    setBusy(true);
    try {
      const p = await api.post<Purchase>("/inventory/purchases", { supplier_id: supplierId, purchase_date: date, invoice_no: invoice, notes, paid_amount: parseFloat(paid) || 0, items: payload });
      toast(`${p.purchase_no} saved - stock added to store`);
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New purchase / goods received" size="xl" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>Save & receive stock</button></>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Supplier">
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Supplier invoice #"><input className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
        <Field label="Amount paid now"><input className="input" type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
      </div>
      <LineEditor items={items} lines={lines} onChange={setLines} withCost />
      <Field label="Notes" className="mt-3"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}
