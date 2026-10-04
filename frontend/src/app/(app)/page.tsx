"use client";

import { AlertTriangle, ChefHat, CircleDollarSign, LayoutGrid, Receipt, ShoppingBag, Truck, Users } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ExportButton from "@/components/ExportButton";
import { ErrorBox, PageHeader, Spinner, StatCard } from "@/components/ui";
import { money, ORDER_TYPE_LABEL, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";

interface Dashboard {
  date: string;
  sales_today: number;
  orders_today: number;
  avg_order_value: number;
  guests_today: number;
  open_orders: number;
  open_orders_value: number;
  cancelled_today: number;
  by_type: Record<string, { orders: number; total: number }>;
  payments: Record<string, number>;
  trend: { date: string; orders: number; total: number }[];
  top_items: { item: string; qty: number; revenue: number }[];
  tables: { total: number; occupied: number };
  low_stock: number;
  kitchen_pending: number;
  pending_deliveries: number;
  expenses_today: number;
}

export default function DashboardPage() {
  const { data, error } = useApi<Dashboard>("/dashboard", undefined, { refreshMs: 30000 });
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;

  const trend = data.trend.map((t) => ({
    ...t,
    label: new Date(`${t.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit" }),
  }));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Today, ${new Date(`${data.date}T00:00:00`).toDateString()}`}
        actions={
          <>
            <ExportButton
              filename="Dashboard"
              sheets={() => [
                {
                  name: "Today",
                  rows: [
                    ["Date", data.date],
                    ["Sales today", data.sales_today],
                    ["Completed orders", data.orders_today],
                    ["Average order value", data.avg_order_value],
                    ["Dine-in covers", data.guests_today],
                    ["Open orders", data.open_orders],
                    ["Open orders value", data.open_orders_value],
                    ["Cancelled orders", data.cancelled_today],
                    ["Tables occupied", `${data.tables.occupied} / ${data.tables.total}`],
                    ["Kitchen queue (items)", data.kitchen_pending],
                    ["Active deliveries", data.pending_deliveries],
                    ["Low stock items", data.low_stock],
                    ["Expenses today", data.expenses_today],
                    ...Object.entries(data.by_type).map(([k, v]) => [`Sales - ${ORDER_TYPE_LABEL[k] ?? k}`, v.total]),
                    ...Object.entries(data.payments).map(([k, v]) => [`Collected - ${titleCase(k)}`, v]),
                  ] as [string, string | number][],
                  columns: [
                    { header: "Metric", value: (r: [string, string | number]) => r[0] },
                    { header: "Value", value: (r: [string, string | number]) => r[1] },
                  ],
                },
                {
                  name: "Last 7 days",
                  rows: data.trend,
                  columns: [
                    { header: "Date", value: (r: Dashboard["trend"][number]) => r.date, type: "date" },
                    { header: "Orders", value: (r: Dashboard["trend"][number]) => r.orders, type: "number" },
                    { header: "Sales", value: (r: Dashboard["trend"][number]) => r.total, type: "money" },
                  ],
                },
                {
                  name: "Top items today",
                  rows: data.top_items,
                  columns: [
                    { header: "Item", value: (r: Dashboard["top_items"][number]) => r.item },
                    { header: "Qty", value: (r: Dashboard["top_items"][number]) => r.qty, type: "number" },
                    { header: "Revenue", value: (r: Dashboard["top_items"][number]) => r.revenue, type: "money" },
                  ],
                },
              ]}
            />
          <Link href="/pos" className="btn-primary">
            <ShoppingBag size={16} /> New Order
          </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sales today" value={money(data.sales_today)} sub={`${data.orders_today} completed orders`} icon={<CircleDollarSign size={20} />} tone="green" />
        <StatCard label="Avg order value" value={money(data.avg_order_value)} sub={`${data.guests_today} dine-in covers`} icon={<Receipt size={20} />} tone="blue" />
        <StatCard label="Open orders" value={data.open_orders} sub={`${money(data.open_orders_value)} in progress`} icon={<ShoppingBag size={20} />} />
        <StatCard
          label="Tables occupied"
          value={`${data.tables.occupied} / ${data.tables.total}`}
          sub={data.tables.total ? `${Math.round((data.tables.occupied * 100) / data.tables.total)}% occupancy` : "-"}
          icon={<LayoutGrid size={20} />}
          tone="slate"
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/kitchen">
          <StatCard label="Kitchen queue" value={data.kitchen_pending} sub="items waiting / cooking" icon={<ChefHat size={20} />} />
        </Link>
        <Link href="/deliveries">
          <StatCard label="Active deliveries" value={data.pending_deliveries} sub="pending or on the way" icon={<Truck size={20} />} tone="blue" />
        </Link>
        <Link href="/inventory/stock?low=1">
          <StatCard label="Low stock items" value={data.low_stock} sub="at or below reorder level" icon={<AlertTriangle size={20} />} tone={data.low_stock ? "red" : "green"} />
        </Link>
        <StatCard label="Expenses today" value={money(data.expenses_today)} sub={`${data.cancelled_today} cancelled orders today`} icon={<Users size={20} />} tone="slate" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="card p-4 xl:col-span-2">
          <h3 className="mb-3 font-semibold">Sales - last 7 days</h3>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Bar dataKey="total" name="Sales" fill="#ea580c" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">Today by order type</h3>
          <div className="space-y-3">
            {(["dine_in", "takeaway", "delivery"] as const).map((t) => {
              const v = data.by_type[t] ?? { orders: 0, total: 0 };
              const pct = data.sales_today ? (v.total * 100) / data.sales_today : 0;
              return (
                <div key={t}>
                  <div className="flex justify-between text-sm">
                    <span>{ORDER_TYPE_LABEL[t]} <span className="text-slate-400">({v.orders})</span></span>
                    <span className="font-medium">{money(v.total)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <h3 className="mb-2 mt-6 font-semibold">Collections</h3>
          {Object.keys(data.payments).length === 0 && <p className="text-sm text-slate-400">No payments yet today.</p>}
          {Object.entries(data.payments).map(([m, v]) => (
            <div key={m} className="flex justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
              <span>{titleCase(m)}</span>
              <span className="font-medium">{money(v)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-4 p-4">
        <h3 className="mb-3 font-semibold">Top selling items today</h3>
        {data.top_items.length === 0 ? (
          <p className="text-sm text-slate-400">No sales yet today.</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.top_items.map((i) => (
                <tr key={i.item}>
                  <td>{i.item}</td>
                  <td className="text-right">{i.qty}</td>
                  <td className="text-right">{money(i.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
