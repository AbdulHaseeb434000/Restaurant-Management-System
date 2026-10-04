"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AsyncButton, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, useConfirm, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateOnly, money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Customer } from "@/lib/types";

const EMPTY = { name: "", phone: "", email: "", address: "", notes: "" };

export default function CustomersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { hasRole } = useAuth();
  const [search, setSearch] = useState("");
  const { data, error, reload } = useApi<Customer[]>("/customers", { search, limit: 500 });
  const [edit, setEdit] = useState<(typeof EMPTY & { id?: number }) | null>(null);

  const save = async () => {
    if (!edit) return;
    try {
      const { id, ...body } = edit;
      if (id) await api.put(`/customers/${id}`, body);
      else await api.post("/customers", body);
      toast("Customer saved");
      setEdit(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (c: Customer) => {
    if (!(await confirm({ title: `Delete ${c.name}?`, confirmText: "Delete", danger: true }))) return;
    try {
      await api.del(`/customers/${c.id}`);
      toast("Customer deleted");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageHeader title="Customers" subtitle="Customer directory for take-away and delivery" actions={<button className="btn-primary" onClick={() => setEdit({ ...EMPTY })}><Plus size={16} /> Add customer</button>} />
      <input className="input mb-4 max-w-sm" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty /> : (
          <table className="table-base">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Address</th><th className="text-right">Orders</th><th className="text-right">Total spent</th><th>Since</th><th /></tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}</td>
                  <td>{c.phone}</td>
                  <td className="max-w-xs truncate">{c.address || "-"}</td>
                  <td className="text-right">{c.order_count}</td>
                  <td className="text-right">{money(c.total_spent)}</td>
                  <td>{dateOnly(c.created_at)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setEdit({ id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes })} aria-label="Edit"><Pencil size={14} /></button>
                    {hasRole("manager") && <button className="btn-ghost btn-sm text-red-600" onClick={() => remove(c)} aria-label="Delete"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit customer" : "Add customer"} footer={<AsyncButton onClick={save}>Save</AsyncButton>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Email" className="sm:col-span-2"><input className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><textarea className="input" rows={2} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Notes" className="sm:col-span-2"><textarea className="input" rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
