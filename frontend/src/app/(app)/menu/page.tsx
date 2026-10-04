"use client";

import clsx from "clsx";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AsyncButton, Badge, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, useConfirm, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { MenuCategory, MenuItem } from "@/lib/types";

type ItemForm = Omit<MenuItem, "id" | "category_name"> & { id?: number };
type CatForm = { id?: number; name: string; sort_order: number; is_active: boolean };

export default function MenuPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [cat, setCat] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const { data: categories, reload: reloadCats } = useApi<MenuCategory[]>("/menu/categories", { include_inactive: true });
  const { data: items, error, reload } = useApi<MenuItem[]>("/menu/items", { include_inactive: true, search, category_id: cat === "all" ? undefined : cat });
  const [item, setItem] = useState<ItemForm | null>(null);
  const [catForm, setCatForm] = useState<CatForm | null>(null);

  const newItem = (): ItemForm => ({
    category_id: cat === "all" ? categories?.[0]?.id ?? 0 : cat,
    name: "",
    code: "",
    description: "",
    price: 0,
    cost_price: 0,
    is_available: true,
    is_active: true,
    available_dine_in: true,
    available_takeaway: true,
    available_delivery: true,
  });

  const saveItem = async () => {
    if (!item) return;
    try {
      const { id, ...body } = item;
      const payload = { ...body, price: Number(body.price), cost_price: Number(body.cost_price) };
      if (id) await api.put(`/menu/items/${id}`, payload);
      else await api.post("/menu/items", payload);
      toast("Menu item saved");
      setItem(null);
      reload();
      reloadCats();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveCat = async () => {
    if (!catForm) return;
    try {
      const { id, ...body } = catForm;
      if (id) await api.put(`/menu/categories/${id}`, body);
      else await api.post("/menu/categories", body);
      toast("Category saved");
      setCatForm(null);
      reloadCats();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const del = async (path: string, label: string, after: () => void) => {
    if (!(await confirm({ title: `Delete ${label}?`, message: "Items that were already sold are hidden instead of deleted, so reports stay intact.", confirmText: "Delete", danger: true }))) return;
    try {
      await api.del(path);
      toast(`${label} deleted`);
      after();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const toggleAvail = async (m: MenuItem) => {
    try {
      await api.patch(`/menu/items/${m.id}/availability`, undefined, { is_available: !m.is_available });
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Menu Management"
        subtitle="Categories, items, prices and availability"
        actions={
          <>
            <button className="btn-secondary" onClick={() => setCatForm({ name: "", sort_order: (categories?.length ?? 0) + 1, is_active: true })}><Plus size={16} /> Category</button>
            <button className="btn-primary" disabled={!categories?.length} onClick={() => setItem(newItem())}><Plus size={16} /> Menu item</button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="card self-start p-2">
          <button className={clsx("w-full rounded-lg px-3 py-2 text-left text-sm", cat === "all" ? "bg-brand-50 font-semibold text-brand-700" : "hover:bg-slate-50")} onClick={() => setCat("all")}>
            All categories
          </button>
          {(categories ?? []).map((c) => (
            <div key={c.id} className={clsx("group flex items-center rounded-lg", cat === c.id ? "bg-brand-50" : "hover:bg-slate-50")}>
              <button className={clsx("flex-1 px-3 py-2 text-left text-sm", cat === c.id && "font-semibold text-brand-700", !c.is_active && "text-slate-400 line-through")} onClick={() => setCat(c.id)}>
                {c.name} <span className="text-xs text-slate-400">({c.item_count})</span>
              </button>
              <button className="btn-ghost btn-sm lg:opacity-0 lg:group-hover:opacity-100" onClick={() => setCatForm({ id: c.id, name: c.name, sort_order: c.sort_order, is_active: c.is_active })} aria-label="Edit category"><Pencil size={13} /></button>
              <button className="btn-ghost btn-sm text-red-600 lg:opacity-0 lg:group-hover:opacity-100" onClick={() => del(`/menu/categories/${c.id}`, `category ${c.name}`, reloadCats)} aria-label="Delete category"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div>
          <input className="input mb-3 max-w-sm" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ErrorBox message={error} />
          <div className="card overflow-x-auto">
            {!items ? <Spinner /> : items.length === 0 ? <Empty message="No menu items." /> : (
              <table className="table-base">
                <thead>
                  <tr><th>Code</th><th>Item</th><th>Category</th><th className="text-right">Price</th><th className="text-right">Cost</th><th>Channels</th><th>Available</th><th /></tr>
                </thead>
                <tbody>
                  {items.map((m) => (
                    <tr key={m.id} className={clsx(!m.is_active && "opacity-50")}>
                      <td className="text-xs text-slate-500">{m.code ?? "-"}</td>
                      <td>
                        <div className="font-medium">{m.name}</div>
                        {m.description && <div className="text-xs text-slate-500">{m.description}</div>}
                        {!m.is_active && <Badge color="red">INACTIVE</Badge>}
                      </td>
                      <td>{m.category_name}</td>
                      <td className="text-right font-medium">{money(m.price)}</td>
                      <td className="text-right text-slate-500">{money(m.cost_price)}</td>
                      <td className="space-x-1 whitespace-nowrap">
                        {m.available_dine_in && <Badge color="blue">Dine</Badge>}
                        {m.available_takeaway && <Badge color="purple">Take</Badge>}
                        {m.available_delivery && <Badge color="orange">Deliv</Badge>}
                      </td>
                      <td>
                        <button onClick={() => toggleAvail(m)} className={clsx("relative h-5 w-9 rounded-full transition", m.is_available ? "bg-emerald-500" : "bg-slate-300")} aria-label="Toggle availability">
                          <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition", m.is_available ? "left-4" : "left-0.5")} />
                        </button>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <button className="btn-ghost btn-sm" onClick={() => setItem({ ...m })} aria-label="Edit"><Pencil size={14} /></button>
                        <button className="btn-ghost btn-sm text-red-600" onClick={() => del(`/menu/items/${m.id}`, m.name, reload)} aria-label="Delete"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <Modal open={!!item} onClose={() => setItem(null)} title={item?.id ? "Edit menu item" : "New menu item"} footer={<AsyncButton onClick={saveItem}>Save</AsyncButton>}>
        {item && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><input className="input" autoFocus value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} /></Field>
            <Field label="Category">
              <select className="input" value={item.category_id} onChange={(e) => setItem({ ...item, category_id: Number(e.target.value) })}>
                {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Code (optional)"><input className="input" value={item.code ?? ""} onChange={(e) => setItem({ ...item, code: e.target.value })} /></Field>
            <Field label="Sale price"><input className="input" type="number" min={0} step="0.01" value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value as unknown as number })} /></Field>
            <Field label="Estimated cost"><input className="input" type="number" min={0} step="0.01" value={item.cost_price} onChange={(e) => setItem({ ...item, cost_price: e.target.value as unknown as number })} /></Field>
            <Field label="Description" className="sm:col-span-2"><textarea className="input" rows={2} value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} /></Field>
            <div className="space-y-2 sm:col-span-2">
              <div className="label">Sold for</div>
              <div className="flex flex-wrap gap-4">
                <Toggle label="Dine-in" checked={item.available_dine_in} onChange={(v) => setItem({ ...item, available_dine_in: v })} />
                <Toggle label="Take-away" checked={item.available_takeaway} onChange={(v) => setItem({ ...item, available_takeaway: v })} />
                <Toggle label="Delivery" checked={item.available_delivery} onChange={(v) => setItem({ ...item, available_delivery: v })} />
              </div>
              <div className="flex flex-wrap gap-4 pt-2">
                <Toggle label="Available now" checked={item.is_available} onChange={(v) => setItem({ ...item, is_available: v })} />
                <Toggle label="Active (shown on menu)" checked={item.is_active} onChange={(v) => setItem({ ...item, is_active: v })} />
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!catForm} onClose={() => setCatForm(null)} title={catForm?.id ? "Edit category" : "New category"} size="sm" footer={<AsyncButton onClick={saveCat}>Save</AsyncButton>}>
        {catForm && (
          <div className="space-y-3">
            <Field label="Name"><input className="input" autoFocus value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} /></Field>
            <Field label="Sort order"><input className="input" type="number" value={catForm.sort_order} onChange={(e) => setCatForm({ ...catForm, sort_order: Number(e.target.value) })} /></Field>
            <Toggle label="Active" checked={catForm.is_active} onChange={(v) => setCatForm({ ...catForm, is_active: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
