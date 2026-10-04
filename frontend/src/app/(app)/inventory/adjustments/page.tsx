"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { AsyncButton, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import ExportButton from "@/components/ExportButton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateOnly, daysAgo, isoDate, money, qty, titleCase } from "@/lib/format";
import { adjustmentsSheets } from "@/lib/exports";
import { useApi } from "@/lib/hooks";
import type { Adjustment, InventoryItem } from "@/lib/types";

const REASONS = [
  { key: "wastage", label: "Wastage / spoilage", sign: -1 },
  { key: "damage", label: "Damage / breakage", sign: -1 },
  { key: "consumption", label: "Kitchen consumption (closing count)", sign: -1 },
  { key: "count_correction", label: "Physical count correction (+/-)", sign: 0 },
  { key: "opening", label: "Opening stock", sign: 1 },
] as const;

export default function AdjustmentsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const isKitchen = user?.role === "kitchen";
  const [dateFrom, setDateFrom] = useState(daysAgo(14));
  const [dateTo, setDateTo] = useState(isoDate());
  const [location, setLocation] = useState("");
  const { data, error, reload } = useApi<Adjustment[]>("/inventory/adjustments", { date_from: dateFrom, date_to: dateTo, location });
  const { data: items, reload: reloadItems } = useApi<InventoryItem[]>("/inventory/items");
  const [form, setForm] = useState<{ item_id: number | ""; location: "store" | "kitchen"; reason: string; quantity: string; unit_cost: string; notes: string; date: string } | null>(null);

  const reason = REASONS.find((r) => r.key === form?.reason);
  const selected = items?.find((i) => i.id === form?.item_id);

  const save = async () => {
    if (!form || !form.item_id) return toast("Select an item", "error");
    let q = parseFloat(form.quantity) || 0;
    if (reason && reason.sign !== 0) q = Math.abs(q) * reason.sign;
    if (!q) return toast("Enter a quantity", "error");
    try {
      await api.post("/inventory/adjustments", {
        adjustment_date: form.date,
        item_id: form.item_id,
        location: form.location,
        reason: form.reason,
        quantity: q,
        unit_cost: form.reason === "opening" && form.unit_cost ? parseFloat(form.unit_cost) : null,
        notes: form.notes,
      });
      toast("Adjustment recorded");
      setForm(null);
      reload();
      reloadItems();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const loss = (data ?? []).filter((a) => a.value < 0).reduce((s, a) => s + a.value, 0);

  return (
    <div>
      <PageHeader
        title="Stock Adjustments & Wastage"
        subtitle={`${data?.length ?? 0} entries · ${money(-loss)} written off`}
        actions={<><ExportButton filename="Stock_adjustments" sheets={() => adjustmentsSheets(data ?? [])} disabled={!data?.length} /><button className="btn-primary" onClick={() => setForm({ item_id: "", location: isKitchen ? "kitchen" : "store", reason: "wastage", quantity: "", unit_cost: "", notes: "", date: isoDate() })}><Plus size={16} /> New adjustment</button></>}
      />
      <div className="card mb-4 flex flex-wrap gap-3 p-3">
        <input className="input w-auto" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From" />
        <input className="input w-auto" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To" />
        <select className="input w-auto" value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location">
          <option value="">Store & kitchen</option>
          <option value="store">Store</option>
          <option value="kitchen">Kitchen</option>
        </select>
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty message="No adjustments in this period." /> : (
          <table className="table-base">
            <thead><tr><th>Date</th><th>Item</th><th>Location</th><th>Reason</th><th className="text-right">Qty</th><th className="text-right">Value</th><th>Notes</th><th>By</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>{dateOnly(a.adjustment_date)}</td>
                  <td className="font-medium">{a.item_name}</td>
                  <td className="capitalize">{a.location}</td>
                  <td>{titleCase(a.reason)}</td>
                  <td className={`text-right ${a.quantity < 0 ? "text-red-600" : "text-emerald-600"}`}>{a.quantity > 0 ? "+" : ""}{qty(a.quantity)} {a.unit_name}</td>
                  <td className="text-right">{money(a.value)}</td>
                  <td className="max-w-xs truncate text-slate-500">{a.notes || "-"}</td>
                  <td>{a.created_by_name ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title="New stock adjustment" footer={<AsyncButton onClick={save}>Save</AsyncButton>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Item" className="sm:col-span-2">
              <select className="input" value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value ? Number(e.target.value) : "" })}>
                <option value="">Select…</option>
                {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit_name})</option>)}
              </select>
            </Field>
            {selected && (
              <p className="text-xs text-slate-500 sm:col-span-2">
                Store: <b>{qty(selected.store_qty)}</b> · Kitchen: <b>{qty(selected.kitchen_qty)}</b> {selected.unit_name} · Avg cost {money(selected.avg_cost)}
              </p>
            )}
            <Field label="Location">
              <select className="input" value={form.location} disabled={isKitchen} onChange={(e) => setForm({ ...form, location: e.target.value as "store" | "kitchen" })}>
                <option value="store">Store</option>
                <option value="kitchen">Kitchen</option>
              </select>
            </Field>
            <Field label="Reason">
              <select className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                {REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </Field>
            <Field label={reason?.sign === 0 ? "Quantity (+ add / - remove)" : reason?.sign === 1 ? "Quantity to add" : "Quantity to remove"}>
              <input className="input" type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
            <Field label="Date"><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            {form.reason === "opening" && (
              <Field label="Unit cost (for valuation)"><input className="input" type="number" min={0} step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></Field>
            )}
            <Field label="Notes" className="sm:col-span-2"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
