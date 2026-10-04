"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { AsyncButton, Badge, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { dateOnly } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Role, User } from "@/lib/types";

const ROLES: { key: Role; desc: string }[] = [
  { key: "admin", desc: "Everything incl. users" },
  { key: "manager", desc: "All operations, menu, inventory, reports, settings" },
  { key: "cashier", desc: "POS, payments, discounts, deliveries, dashboard" },
  { key: "waiter", desc: "Take & modify orders, tables, KDS" },
  { key: "kitchen", desc: "Kitchen display, kitchen stock adjustments" },
  { key: "storekeeper", desc: "Inventory: items, purchases, issues, adjustments" },
];

type Form = { id?: number; username: string; full_name: string; password: string; role: Role; is_active: boolean };

export default function UsersPage() {
  const toast = useToast();
  const { data, error, reload } = useApi<User[]>("/users");
  const [form, setForm] = useState<Form | null>(null);

  const save = async () => {
    if (!form) return;
    try {
      if (form.id) {
        await api.put(`/users/${form.id}`, { full_name: form.full_name, role: form.role, is_active: form.is_active, ...(form.password ? { password: form.password } : {}) });
      } else {
        await api.post("/users", form);
      }
      toast("User saved");
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageHeader title="Users & Roles" subtitle="Staff accounts and what they can access" actions={<button className="btn-primary" onClick={() => setForm({ username: "", full_name: "", password: "", role: "cashier", is_active: true })}><Plus size={16} /> Add user</button>} />
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty /> : (
          <table className="table-base">
            <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.username}</td>
                  <td>{u.full_name}</td>
                  <td className="capitalize">{u.role}</td>
                  <td>{u.is_active ? <Badge color="green">ACTIVE</Badge> : <Badge color="red">DISABLED</Badge>}</td>
                  <td>{dateOnly(u.created_at)}</td>
                  <td className="text-right"><button className="btn-ghost btn-sm" aria-label="Edit" onClick={() => setForm({ id: u.id, username: u.username, full_name: u.full_name, password: "", role: u.role, is_active: u.is_active })}><Pencil size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card mt-4 p-4">
        <h3 className="mb-2 font-semibold">Role permissions</h3>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {ROLES.map((r) => <li key={r.key}><b className="capitalize">{r.key}</b> - <span className="text-slate-600">{r.desc}</span></li>)}
        </ul>
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit user" : "Add user"} footer={<AsyncButton onClick={save}>Save</AsyncButton>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Username"><input className="input" disabled={!!form.id} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="Full name"><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
            <Field label={form.id ? "New password (leave blank to keep)" : "Password (min 6 chars)"}><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Role">
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r.key} value={r.key}>{r.key}</option>)}
              </select>
            </Field>
            <Toggle label="Active" checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
