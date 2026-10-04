"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import ExportButton from "@/components/ExportButton";
import { Empty, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { dateOnly, daysAgo, isoDate, money, qty, titleCase } from "@/lib/format";
import { ledgerSheets } from "@/lib/exports";
import { useApi } from "@/lib/hooks";
import type { InventoryItem, Movement } from "@/lib/types";

export default function LedgerPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Ledger />
    </Suspense>
  );
}

function Ledger() {
  const params = useSearchParams();
  const [itemId, setItemId] = useState(params.get("item") ?? "");
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo, setDateTo] = useState(isoDate());
  const { data: items } = useApi<InventoryItem[]>("/inventory/items", { include_inactive: true });
  const { data, error } = useApi<Movement[]>("/inventory/movements", { item_id: itemId || undefined, location, movement_type: type, date_from: dateFrom, date_to: dateTo, limit: 1000 });

  return (
    <div>
      <PageHeader actions={<ExportButton filename="Stock_ledger" sheets={() => ledgerSheets(data ?? [])} disabled={!data?.length} />} title="Stock Ledger" subtitle="Every stock movement in and out of the store and kitchen" />
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-3 lg:grid-cols-5">
        <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Item">
          <option value="">All items</option>
          {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select className="input" value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location">
          <option value="">Store & kitchen</option>
          <option value="store">Store</option>
          <option value="kitchen">Kitchen</option>
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All movement types</option>
          {["purchase", "purchase_cancel", "issue_out", "issue_in", "adjustment"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
        <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From" />
        <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To" />
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.length === 0 ? <Empty message="No movements." /> : (
          <table className="table-base">
            <thead><tr><th>Date</th><th>Item</th><th>Location</th><th>Type</th><th>Reference</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Balance</th><th>Notes</th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{dateOnly(m.movement_date)}</td>
                  <td className="font-medium">{m.item_name}</td>
                  <td className="capitalize">{m.location}</td>
                  <td>{titleCase(m.movement_type)}</td>
                  <td className="text-xs">{m.ref_no}</td>
                  <td className={`text-right ${m.quantity < 0 ? "text-red-600" : "text-emerald-600"}`}>{m.quantity > 0 ? "+" : ""}{qty(m.quantity)} {m.unit_name}</td>
                  <td className="text-right">{money(m.unit_cost)}</td>
                  <td className="text-right font-medium">{qty(m.balance_after)}</td>
                  <td className="max-w-xs truncate text-xs text-slate-500">{m.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
