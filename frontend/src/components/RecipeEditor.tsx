"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money, qty as fmtQty } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { InventoryItem, MenuItem, Recipe } from "@/lib/types";
import { AsyncButton, Modal, Spinner, useToast } from "./ui";

interface Line {
  inventory_item_id: number | "";
  quantity: string;
}

/** Edit the ingredients used for ONE portion of a menu item. */
export default function RecipeEditor({ item, onClose, onSaved }: { item: MenuItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { settings } = useAuth();
  const { data: recipe } = useApi<Recipe>(item ? `/menu/items/${item.id}/recipe` : null);
  const { data: inventory } = useApi<InventoryItem[]>(item ? "/inventory/items" : null);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (recipe && recipe.menu_item_id === item?.id) {
      setLines(recipe.lines.length ? recipe.lines.map((l) => ({ inventory_item_id: l.inventory_item_id, quantity: String(l.quantity) })) : [{ inventory_item_id: "", quantity: "" }]);
    }
  }, [recipe, item]);

  const byId = useMemo(() => new Map((inventory ?? []).map((i) => [i.id, i])), [inventory]);
  const cost = lines.reduce((s, l) => {
    const inv = l.inventory_item_id ? byId.get(l.inventory_item_id) : undefined;
    return s + (inv ? (parseFloat(l.quantity) || 0) * inv.avg_cost : 0);
  }, 0);
  const price = item?.price ?? 0;
  const pct = price ? (cost * 100) / price : 0;
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!item) return;
    const payload = lines
      .filter((l) => l.inventory_item_id && parseFloat(l.quantity) > 0)
      .map((l) => ({ inventory_item_id: Number(l.inventory_item_id), quantity: parseFloat(l.quantity) }));
    try {
      await api.put(`/menu/items/${item.id}/recipe`, { lines: payload });
      toast(payload.length ? `Recipe saved for ${item.name}` : `Recipe cleared for ${item.name}`);
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={`Recipe - ${item?.name ?? ""} (per 1 portion)`}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <AsyncButton onClick={save}>Save recipe</AsyncButton>
        </>
      }
    >
      {settings?.inventory_mode !== "recipe" && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Recipe mapping is currently <b>off</b> (Settings → Inventory method). Recipes are used for costing reports only and do not deduct stock until it is switched on.
        </div>
      )}
      {!recipe || !inventory ? (
        <Spinner />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-1/2">Ingredient</th>
                  <th>Qty / portion</th>
                  <th className="text-right">Avg cost</th>
                  <th className="text-right">Cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const inv = l.inventory_item_id ? byId.get(l.inventory_item_id) : undefined;
                  return (
                    <tr key={i}>
                      <td>
                        <select className="input" value={l.inventory_item_id} aria-label="Ingredient" onChange={(e) => update(i, { inventory_item_id: e.target.value ? Number(e.target.value) : "" })}>
                          <option value="">Select ingredient…</option>
                          {inventory.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name} ({it.unit_name})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <input className="input w-24" type="number" min="0" step="0.001" value={l.quantity} aria-label="Quantity per portion" onChange={(e) => update(i, { quantity: e.target.value })} />
                          <span className="text-xs text-slate-500">{inv?.unit_name}</span>
                        </div>
                      </td>
                      <td className="text-right text-slate-500">{inv ? money(inv.avg_cost) : "-"}</td>
                      <td className="text-right">{inv ? money((parseFloat(l.quantity) || 0) * inv.avg_cost) : "-"}</td>
                      <td>
                        <button className="btn-ghost btn-sm text-red-600" aria-label="Remove ingredient" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button className="btn-secondary btn-sm mt-2" onClick={() => setLines((ls) => [...ls, { inventory_item_id: "", quantity: "" }])}>
            <Plus size={14} /> Add ingredient
          </button>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Recipe cost</div>
              <div className="text-lg font-bold">{money(cost)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Margin per portion</div>
              <div className="text-lg font-bold">{money(price - cost)}</div>
            </div>
            <div className={`rounded-lg p-3 ${pct > 40 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
              <div className="text-xs">Food cost % (price {money(price)})</div>
              <div className="text-lg font-bold">{fmtQty(Math.round(pct * 10) / 10)}%</div>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Quantities are in each ingredient&apos;s unit (e.g. 0.25 kg). Costs use current weighted-average purchase prices. Saving also updates the item&apos;s estimated cost.
          </p>
        </>
      )}
    </Modal>
  );
}
