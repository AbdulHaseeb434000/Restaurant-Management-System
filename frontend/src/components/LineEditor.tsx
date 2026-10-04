"use client";

import { Plus, Trash2 } from "lucide-react";
import { money, qty as fmtQty } from "@/lib/format";
import type { InventoryItem } from "@/lib/types";

export interface EditableLine {
  item_id: number | "";
  quantity: string;
  unit_cost?: string;
}

/** Table editor for purchase / issue lines. With `withCost` the user enters a unit cost. */
export default function LineEditor({
  items,
  lines,
  onChange,
  withCost,
  showStore,
}: {
  items: InventoryItem[];
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  withCost?: boolean;
  showStore?: boolean;
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const update = (idx: number, patch: Partial<EditableLine>) => onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => {
    const it = l.item_id ? byId.get(l.item_id) : undefined;
    const cost = withCost ? parseFloat(l.unit_cost ?? "") || 0 : it?.avg_cost ?? 0;
    return s + (parseFloat(l.quantity) || 0) * cost;
  }, 0);

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-[40%]">Item</th>
              {showStore && <th className="text-right">In store</th>}
              <th>Qty</th>
              <th>{withCost ? "Unit cost" : "Avg cost"}</th>
              <th className="text-right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const it = l.item_id ? byId.get(l.item_id) : undefined;
              const cost = withCost ? parseFloat(l.unit_cost ?? "") || 0 : it?.avg_cost ?? 0;
              const over = showStore && it && (parseFloat(l.quantity) || 0) > it.store_qty;
              return (
                <tr key={idx}>
                  <td>
                    <select
                      className="input"
                      value={l.item_id}
                      aria-label="Item"
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : "";
                        const sel = id ? byId.get(id) : undefined;
                        update(idx, { item_id: id, ...(withCost && sel && !l.unit_cost ? { unit_cost: String(sel.last_purchase_price || "") } : {}) });
                      }}
                    >
                      <option value="">Select item…</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.unit_name})
                        </option>
                      ))}
                    </select>
                  </td>
                  {showStore && <td className="whitespace-nowrap text-right text-slate-500">{it ? `${fmtQty(it.store_qty)} ${it.unit_name}` : "-"}</td>}
                  <td>
                    <input className={`input w-24 ${over ? "border-red-400" : ""}`} type="number" min="0" step="0.001" value={l.quantity} onChange={(e) => update(idx, { quantity: e.target.value })} aria-label="Quantity" />
                  </td>
                  <td>
                    {withCost ? (
                      <input className="input w-28" type="number" min="0" step="0.01" value={l.unit_cost ?? ""} onChange={(e) => update(idx, { unit_cost: e.target.value })} aria-label="Unit cost" />
                    ) : (
                      <span className="text-slate-500">{money(cost)}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">{money((parseFloat(l.quantity) || 0) * cost)}</td>
                  <td>
                    <button className="btn-ghost btn-sm text-red-600" onClick={() => onChange(lines.filter((_, i) => i !== idx))} aria-label="Remove line">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button className="btn-secondary btn-sm" onClick={() => onChange([...lines, { item_id: "", quantity: "", unit_cost: "" }])}>
          <Plus size={14} /> Add line
        </button>
        <div className="text-sm">
          Total: <b>{money(total)}</b>
        </div>
      </div>
    </div>
  );
}

export function validLines(lines: EditableLine[], withCost?: boolean) {
  return lines
    .filter((l) => l.item_id && parseFloat(l.quantity) > 0)
    .map((l) => ({
      item_id: Number(l.item_id),
      quantity: parseFloat(l.quantity),
      ...(withCost ? { unit_cost: parseFloat(l.unit_cost ?? "") || 0 } : {}),
    }));
}
