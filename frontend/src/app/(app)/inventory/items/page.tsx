"use client";

import { Pencil, Plus, Ruler, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { AsyncButton, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, useConfirm, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { money, qty } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { InventoryItem, Named, Unit } from "@/lib/types";

interface Form {
  id?: number;
  name: string;
  sku: string;
  category_id: number | "";
  unit_id: number | "";
  reorder_level: string;
  is_active: boolean;
}

export default function InventoryItemsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const { data, error, reload } = useApi<InventoryItem[]>("/inventory/items", { search, include_inactive: true });
  const { data: units, reload: reloadUnits } = useApi<Unit[]>("/inventory/units");
  const { data: cats, reload: reloadCats } = useApi<Named[]>("/inventory/categories");
  const [form, setForm] = useState<Form | null>(null);
  const [mastersOpen, setMastersOpen] = useState<"units" | "cats" | null>(null);

  const save = async () => {
    if (!form) return;
    if (!form.unit_id) return toast("Select a unit", "error");
    const body = {
      name: form.name,
      sku: form.sku || null,
      category_id: form.category_id || null,
      unit_id: form.unit_id,
      reorder_level: parseFloat(form.reorder_level) || 0,
      is_active: form.is_active,
    };
    try {
      if (form.id) await api.put(`/inventory/items/${form.id}`, body);
      else await api.post("/inventory/items", body);
      toast("Item saved");
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (i: InventoryItem) => {
    if (!(await confirm({ title: `Delete ${i.name}?`, message: "Items with stock history are deactivated instead.", confirmText: "Delete", danger: true }))) return;
    try {
      await api.del(`/inventory/items/${i.id}`);
      toast("Item removed");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Items / Ingredients"
        subtitle="Raw materials kept in store and issued to the kitchen"
        actions={
          <>
            <button className="btn-secondary" onClick={() => setMastersOpen("units")}><Ruler size={16} /> Units</button>
            <button className="btn-secondary" onClick={() => setMastersOpen("cats")}><Tags size={16} /> Categories</button>
            <button className="btn-primary" onClick={() => setForm({ name: "", sku: "", category_id: "", unit_id: units?.[0]?.id ?? "", reorder_level: "0", is_active: true })}><Plus size={16} /> New item</button>
          </>
        }
      />
      <input className="input mb-4 max-w-sm" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty /> : (
          <table className="table-base">
            <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Unit</th><th className="text-right">Reorder level</th><th className="text-right">Store</th><th className="text-right">Kitchen</th><th className="text-right">Avg cost</th><th>Active</th><th /></tr></thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id} className={i.is_active ? "" : "opacity-50"}>
                  <td className="text-xs text-slate-500">{i.sku ?? "-"}</td>
                  <td className="font-medium">{i.name}</td>
                  <td>{i.category_name ?? "-"}</td>
                  <td>{i.unit_name}</td>
                  <td className="text-right">{qty(i.reorder_level)}</td>
                  <td className="text-right">{qty(i.store_qty)}</td>
                  <td className="text-right">{qty(i.kitchen_qty)}</td>
                  <td className="text-right">{money(i.avg_cost)}</td>
                  <td>{i.is_active ? "Yes" : "No"}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" aria-label="Edit" onClick={() => setForm({ id: i.id, name: i.name, sku: i.sku ?? "", category_id: i.category_id ?? "", unit_id: i.unit_id, reorder_level: String(i.reorder_level), is_active: i.is_active })}><Pencil size={14} /></button>
                    <button className="btn-ghost btn-sm text-red-600" aria-label="Delete" onClick={() => remove(i)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit item" : "New item"} footer={<AsyncButton onClick={save}>Save</AsyncButton>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="SKU / Code"><input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
            <Field label="Category">
              <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : "" })}>
                <option value="">- none -</option>
                {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Unit of measure">
              <select className="input" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value ? Number(e.target.value) : "" })}>
                <option value="">Select…</option>
                {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
              </select>
            </Field>
            <Field label="Reorder level (store)"><input className="input" type="number" min={0} step="0.001" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></Field>
            <Toggle label="Active" checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
            {!form.id && <p className="text-xs text-slate-500 sm:col-span-2">Opening stock: record a purchase, or an adjustment with reason “Opening”.</p>}
          </div>
        )}
      </Modal>

      <MastersModal
        mode={mastersOpen}
        units={units ?? []}
        cats={cats ?? []}
        onClose={() => setMastersOpen(null)}
        onChanged={() => {
          reloadUnits();
          reloadCats();
        }}
      />
    </div>
  );
}

function MastersModal({ mode, units, cats, onClose, onChanged }: { mode: "units" | "cats" | null; units: Unit[]; cats: Named[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [abbr, setAbbr] = useState("");
  const base = mode === "units" ? "/inventory/units" : "/inventory/categories";

  const add = async () => {
    try {
      await api.post(base, mode === "units" ? { name, abbreviation: abbr } : { name });
      setName("");
      setAbbr("");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const del = async (id: number) => {
    try {
      await api.del(`${base}/${id}`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const list: { id: number; label: string }[] = mode === "units" ? units.map((u) => ({ id: u.id, label: `${u.name} (${u.abbreviation})` })) : cats.map((c) => ({ id: c.id, label: c.name }));

  return (
    <Modal open={!!mode} onClose={onClose} title={mode === "units" ? "Units of measure" : "Item categories"} size="sm">
      <div className="mb-3 flex gap-2">
        <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        {mode === "units" && <input className="input w-24" placeholder="Abbr." value={abbr} onChange={(e) => setAbbr(e.target.value)} />}
        <button className="btn-primary" disabled={!name.trim() || (mode === "units" && !abbr.trim())} onClick={add}><Plus size={16} /></button>
      </div>
      <ul className="divide-y divide-slate-100">
        {list.map((l) => (
          <li key={l.id} className="flex items-center justify-between py-1.5 text-sm">
            {l.label}
            <button className="btn-ghost btn-sm text-red-600" onClick={() => del(l.id)} aria-label="Delete"><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
