"use client";

import { Eye, Printer, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Empty, ErrorBox, PageHeader, Spinner, StatusBadge, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime, isoDate, money, ORDER_TYPE_LABEL } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { OrderListItem } from "@/lib/types";

export default function OrdersPage() {
  const toast = useToast();
  const { hasRole } = useAuth();
  const [status, setStatus] = useState("");
  const [orderType, setOrderType] = useState("");
  const [dateFrom, setDateFrom] = useState(isoDate());
  const [dateTo, setDateTo] = useState(isoDate());
  const [search, setSearch] = useState("");
  const { data, error, reload } = useApi<OrderListItem[]>(
    "/orders",
    // open orders are shown regardless of date so nothing gets forgotten from a previous shift
    { status, order_type: orderType, date_from: status === "open" ? undefined : dateFrom, date_to: status === "open" ? undefined : dateTo, search, limit: 500 },
    { refreshMs: 20000 },
  );

  const reopen = async (o: OrderListItem) => {
    if (!confirm(`Reopen ${o.order_no}?`)) return;
    try {
      await api.post(`/orders/${o.id}/reopen`);
      toast(`${o.order_no} reopened`);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const completed = (data ?? []).filter((o) => o.status === "completed");
  const totalSales = completed.reduce((s, o) => s + o.total, 0);

  return (
    <div>
      <PageHeader title="Orders" subtitle={`${data?.length ?? 0} orders · ${completed.length} completed · ${money(totalSales)} sales`} />
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <input className="input" placeholder="Search order #, customer, phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="input" value={orderType} onChange={(e) => setOrderType(e.target.value)} aria-label="Order type">
          <option value="">All types</option>
          <option value="dine_in">Dine-in</option>
          <option value="takeaway">Take-away</option>
          <option value="delivery">Delivery</option>
        </select>
        <input className="input" type="date" disabled={status === "open"} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From" />
        <input className="input" type="date" disabled={status === "open"} value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To" />
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? (
          <Spinner />
        ) : data.length === 0 ? (
          <Empty message="No orders for these filters." />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Time</th>
                <th>Type</th>
                <th>Table / Customer</th>
                <th>Items</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
                <th>Status</th>
                <th>Staff</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">{o.order_no}</td>
                  <td className="whitespace-nowrap">{dateTime(o.created_at)}</td>
                  <td>{ORDER_TYPE_LABEL[o.order_type]}</td>
                  <td>{o.table_name ? `Table ${o.table_name}` : o.customer_name || o.customer_phone || "-"}</td>
                  <td>{o.item_count}</td>
                  <td className="text-right">{money(o.total)}</td>
                  <td className="text-right">{money(o.paid_amount)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                    {o.delivery_status && <span className="ml-1"><StatusBadge status={o.delivery_status} /></span>}
                  </td>
                  <td>{o.created_by_name ?? "-"}</td>
                  <td className="whitespace-nowrap text-right">
                    <Link href={`/pos?order=${o.id}`} className="btn-ghost btn-sm" title="Open"><Eye size={15} /></Link>
                    <Link href={`/print/receipt/${o.id}`} target="_blank" className="btn-ghost btn-sm" title="Receipt"><Printer size={15} /></Link>
                    {o.status === "completed" && hasRole("manager") && (
                      <button className="btn-ghost btn-sm" title="Reopen" onClick={() => reopen(o)}><RotateCcw size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
