"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AsyncButton, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, useConfirm, useToast } from "@/components/ui";
import ExportButton from "@/components/ExportButton";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { suppliersSheets } from "@/lib/exports";
import { useApi } from "@/lib/hooks";
import type { Supplier } from "@/lib/types";

type Form = { id?: number; name: string; contact_person: string; phone: string; email: string; address: string; is_active: boolean };
const EMPTY: Form = { name: "", contact_person: "", phone: "", email: "", address: "", is_active: true };

export default function SuppliersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, reload } = useApi<Supplier[]>("/inventory/suppliers", { include_inactive: true });
  const [form, setForm] = useState<Form | null>(null);

  const save = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      if (id) await api.put(`/inventory/suppliers/${id}`, body);
      else await api.post("/inventory/suppliers", body);
      toast("Supplier saved");
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (s: Supplier) => {
    if (!(await confirm({ title: `Delete ${s.name}?`, message: "Suppliers with purchases are deactivated instead.", confirmText: "Delete", danger: true }))) return;
    try {
      await api.del(`/inventory/suppliers/${s.id}`);
      toast("Supplier removed");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageHeader title="Suppliers" subtitle="Vendors you purchase ingredients from" actions={<><ExportButton filename="Suppliers" sheets={() => suppliersSheets(data ?? [])} disabled={!data?.length} /><button className="btn-primary" onClick={() => setForm({ ...EMPTY })}><Plus size={16} /> Add supplier</button></>} />
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty /> : (
          <table className="table-base">
            <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th className="text-right">Total purchases</th><th className="text-right">Balance due</th><th>Active</th><th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className={s.is_active ? "" : "opacity-50"}>
                  <td className="font-medium">{s.name}</td>
                  <td>{s.contact_person || "-"}</td>
                  <td>{s.phone || "-"}</td>
                  <td className="text-right">{money(s.total_purchases)}</td>
                  <td className={`text-right ${s.balance_due > 0 ? "font-semibold text-red-600" : ""}`}>{money(s.balance_due)}</td>
                  <td>{s.is_active ? "Yes" : "No"}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" aria-label="Edit" onClick={() => setForm({ id: s.id, name: s.name, contact_person: s.contact_person, phone: s.phone, email: s.email, address: s.address, is_active: s.is_active })}><Pencil size={14} /></button>
                    <button className="btn-ghost btn-sm text-red-600" aria-label="Delete" onClick={() => remove(s)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit supplier" : "Add supplier"} footer={<AsyncButton onClick={save}>Save</AsyncButton>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Contact person"><input className="input" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email" className="sm:col-span-2"><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Toggle label="Active" checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
