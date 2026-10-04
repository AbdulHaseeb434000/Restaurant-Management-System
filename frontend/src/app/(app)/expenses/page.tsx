"use client";

import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { dateOnly, isoDate, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Expense, Named } from "@/lib/types";

type Form = { id?: number; expense_date: string; category_id: number | ""; amount: string; paid_to: string; payment_method: string; notes: string };

export default function ExpensesPage() {
  const toast = useToast();
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(isoDate());
  const [catId, setCatId] = useState("");
  const { data, error, reload } = useApi<Expense[]>("/expenses", { date_from: dateFrom, date_to: dateTo, category_id: catId || undefined });
  const { data: cats, reload: reloadCats } = useApi<Named[]>("/expenses/categories");
  const [form, setForm] = useState<Form | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [newCat, setNewCat] = useState("");

  const save = async () => {
    if (!form) return;
    if (!form.category_id) return toast("Select a category", "error");
    try {
      const { id, ...rest } = form;
      const body = { ...rest, amount: parseFloat(rest.amount) || 0 };
      if (id) await api.put(`/expenses/${id}`, body);
      else await api.post("/expenses", body);
      toast("Expense saved");
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (e: Expense) => {
    if (!confirm("Delete this expense?")) return;
    try {
      await api.del(`/expenses/${e.id}`);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const total = (data ?? []).reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={`${data?.length ?? 0} entries · ${money(total)}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setCatsOpen(true)}><Tags size={16} /> Categories</button>
            <button className="btn-primary" onClick={() => setForm({ expense_date: isoDate(), category_id: "", amount: "", paid_to: "", payment_method: "cash", notes: "" })}><Plus size={16} /> Add expense</button>
          </>
        }
      />
      <div className="card mb-4 flex flex-wrap gap-3 p-3">
        <input className="input w-auto" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From" />
        <input className="input w-auto" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To" />
        <select className="input w-auto" value={catId} onChange={(e) => setCatId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty message="No expenses in this period." /> : (
          <table className="table-base">
            <thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Method</th><th>Notes</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td>{dateOnly(e.expense_date)}</td>
                  <td>{e.category_name}</td>
                  <td>{e.paid_to || "-"}</td>
                  <td>{titleCase(e.payment_method)}</td>
                  <td className="max-w-xs truncate text-slate-500">{e.notes || "-"}</td>
                  <td className="text-right font-medium">{money(e.amount)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" aria-label="Edit" onClick={() => setForm({ id: e.id, expense_date: e.expense_date, category_id: e.category_id, amount: String(e.amount), paid_to: e.paid_to, payment_method: e.payment_method, notes: e.notes })}><Pencil size={14} /></button>
                    <button className="btn-ghost btn-sm text-red-600" aria-label="Delete" onClick={() => remove(e)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit expense" : "Add expense"} footer={<button className="btn-primary" onClick={save}>Save</button>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date"><input className="input" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></Field>
            <Field label="Category">
              <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : "" })}>
                <option value="">Select…</option>
                {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Amount"><input className="input" type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Payment method">
              <select className="input" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                {["cash", "card", "online", "bank"].map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
              </select>
            </Field>
            <Field label="Paid to" className="sm:col-span-2"><input className="input" value={form.paid_to} onChange={(e) => setForm({ ...form, paid_to: e.target.value })} /></Field>
            <Field label="Notes" className="sm:col-span-2"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={catsOpen} onClose={() => setCatsOpen(false)} title="Expense categories" size="sm">
        <div className="mb-3 flex gap-2">
          <input className="input" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button className="btn-primary" disabled={!newCat.trim()} onClick={async () => {
            try { await api.post("/expenses/categories", { name: newCat.trim() }); setNewCat(""); reloadCats(); } catch (e) { toast((e as Error).message, "error"); }
          }}><Plus size={16} /></button>
        </div>
        <ul className="divide-y divide-slate-100">
          {(cats ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5 text-sm">{c.name}
              <button className="btn-ghost btn-sm text-red-600" aria-label="Delete" onClick={async () => {
                try { await api.del(`/expenses/categories/${c.id}`); reloadCats(); } catch (e) { toast((e as Error).message, "error"); }
              }}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
