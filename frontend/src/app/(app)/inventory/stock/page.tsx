"use client";

import { AlertTriangle, Boxes, ChefHat, Warehouse } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Empty, ErrorBox, PageHeader, Spinner, StatCard, StatusBadge, Toggle } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { money, qty } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { InventoryItem, Named } from "@/lib/types";

export default function StockPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Stock />
    </Suspense>
  );
}

function Stock() {
  const params = useSearchParams();
  const { hasRole } = useAuth();
  const [lowOnly, setLowOnly] = useState(params.get("low") === "1");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const { data, error } = useApi<InventoryItem[]>("/inventory/items", { search, category_id: cat || undefined, low_stock: lowOnly });
  const { data: all } = useApi<InventoryItem[]>("/inventory/items");
  const { data: cats } = useApi<Named[]>("/inventory/categories");

  const summary = useMemo(() => {
    const items = all ?? [];
    return {
      count: items.length,
      store: items.reduce((s, i) => s + i.store_qty * i.avg_cost, 0),
      kitchen: items.reduce((s, i) => s + i.kitchen_qty * i.avg_cost, 0),
      low: items.filter((i) => i.is_low).length,
    };
  }, [all]);

  const isStore = hasRole("manager", "storekeeper");

  return (
    <div>
      <PageHeader
        title="Stock Overview"
        subtitle="Current store & kitchen stock at weighted-average cost"
        actions={
          isStore && (
            <>
              <Link href="/inventory/purchases?new=1" className="btn-primary">New purchase</Link>
              <Link href="/inventory/issues?new=1" className="btn-secondary">Issue to kitchen</Link>
            </>
          )
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active items" value={summary.count} icon={<Boxes size={20} />} tone="slate" />
        <StatCard label="Store value" value={money(summary.store)} icon={<Warehouse size={20} />} tone="blue" />
        <StatCard label="Kitchen value" value={money(summary.kitchen)} icon={<ChefHat size={20} />} />
        <StatCard label="Low stock" value={summary.low} sub="at/below reorder level" icon={<AlertTriangle size={20} />} tone={summary.low ? "red" : "green"} />
      </div>
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <input className="input max-w-xs" placeholder="Search item / SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-xs" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Toggle label="Low stock only" checked={lowOnly} onChange={setLowOnly} />
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty message="No items." /> : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th><th>Category</th><th className="text-right">Store</th><th className="text-right">Kitchen</th>
                <th className="text-right">Reorder at</th><th className="text-right">Avg cost</th><th className="text-right">Last price</th>
                <th className="text-right">Value</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id}>
                  <td><Link className="font-medium hover:text-brand-700" href={`/inventory/ledger?item=${i.id}`}>{i.name}</Link><div className="text-xs text-slate-400">{i.sku}</div></td>
                  <td>{i.category_name ?? "-"}</td>
                  <td className="text-right font-medium">{qty(i.store_qty)} {i.unit_name}</td>
                  <td className="text-right">{qty(i.kitchen_qty)} {i.unit_name}</td>
                  <td className="text-right text-slate-500">{qty(i.reorder_level)}</td>
                  <td className="text-right">{money(i.avg_cost)}</td>
                  <td className="text-right text-slate-500">{money(i.last_purchase_price)}</td>
                  <td className="text-right">{money(i.stock_value)}</td>
                  <td><StatusBadge status={i.is_low ? "LOW" : "OK"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
