"use client";

import clsx from "clsx";
import { ArrowLeft, Download, Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ExportButton from "@/components/ExportButton";
import { Empty, ErrorBox, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dateOnly, dateTime, daysAgo, isoDate, money, qty } from "@/lib/format";
import { reportSheets } from "@/lib/exports";
import { useApi } from "@/lib/hooks";
import type { ReportColumn, ReportResult } from "@/lib/types";

const COLORS = ["#ea580c", "#0284c7", "#16a34a", "#9333ea", "#ca8a04", "#dc2626", "#0d9488", "#db2777", "#4f46e5", "#64748b"];

const RANGES = [
  { label: "Today", from: 0, to: 0 },
  { label: "Yesterday", from: 1, to: 1 },
  { label: "Last 7 days", from: 6, to: 0 },
  { label: "Last 30 days", from: 29, to: 0 },
  { label: "This month", from: -1, to: 0 },
];

function fmt(col: ReportColumn, v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") return "-";
  switch (col.type) {
    case "money":
      return money(Number(v), false);
    case "percent":
      return `${Number(v).toFixed(2)}%`;
    case "qty":
      return qty(Number(v));
    case "number":
      return Number(v).toLocaleString();
    case "date":
      return dateOnly(String(v));
    case "datetime":
      return dateTime(String(v));
    case "status":
      return <StatusBadge status={String(v)} />;
    default:
      return String(v);
  }
}

function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ReportPage() {
  const { key } = useParams<{ key: string }>();
  const { settings, hasRole } = useAuth();
  const [dateFrom, setDateFrom] = useState(key === "day-end" ? isoDate() : daysAgo(6));
  const [dateTo, setDateTo] = useState(isoDate());
  const { data, error, loading } = useApi<ReportResult>(`/reports/${key}`, { date_from: dateFrom, date_to: dateTo });

  const setRange = (r: (typeof RANGES)[number]) => {
    if (r.from === -1) {
      const d = new Date();
      setDateFrom(isoDate(new Date(d.getFullYear(), d.getMonth(), 1)));
    } else setDateFrom(daysAgo(r.from));
    setDateTo(daysAgo(r.to));
  };

  const chartData = useMemo(() => {
    if (!data?.chart) return [];
    const { x, y, limit, aggregate } = data.chart;
    let rows = data.rows.map((r) => ({ name: String(r[x] ?? "-"), ...Object.fromEntries(y.map((k) => [k, Number(r[k] ?? 0)])) }));
    if (aggregate) {
      const m = new Map<string, Record<string, number | string>>();
      for (const r of rows) {
        const cur = m.get(r.name) ?? { name: r.name, ...Object.fromEntries(y.map((k) => [k, 0])) };
        for (const k of y) cur[k] = Number(cur[k]) + Number((r as Record<string, unknown>)[k]);
        m.set(r.name, cur);
      }
      rows = Array.from(m.values()) as typeof rows;
    }
    return limit ? rows.slice(0, limit) : rows;
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    const header = data.columns.map((c) => csvEscape(c.label)).join(",");
    const body = data.rows.map((r) => data.columns.map((c) => csvEscape(r[c.key])).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.key}_${data.date_from}_${data.date_to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const yLabel = (k: string) => data?.columns.find((c) => c.key === k)?.label ?? k;

  return (
    <div>
      {hasRole("manager") && (
        <div className="no-print mb-2">
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><ArrowLeft size={14} /> All reports</Link>
        </div>
      )}
      <PageHeader
        title={data?.title ?? "Report"}
        subtitle={data?.description}
        actions={
          <>
            {data && <ExportButton filename={data.title} sheets={() => reportSheets(data)} disabled={!data.rows.length} />}
            <button className="btn-secondary" onClick={exportCsv} disabled={!data?.rows.length}><Download size={16} /> CSV</button>
            <button className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print</button>
          </>
        }
      />
      {data?.uses_dates !== false && (
        <div className="no-print card mb-4 flex flex-wrap items-center gap-2 p-3">
          <input className="input w-auto" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From" />
          <span className="text-slate-400">to</span>
          <input className="input w-auto" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To" />
          <div className="ml-2 flex flex-wrap gap-1.5">
            {RANGES.map((r) => <button key={r.label} className="btn-secondary btn-sm" onClick={() => setRange(r)}>{r.label}</button>)}
          </div>
          {loading && <span className="text-xs text-slate-400">Loading…</span>}
        </div>
      )}
      {/* print header */}
      <div className="mb-3 hidden print:block">
        <div className="text-lg font-bold">{settings?.restaurant_name}</div>
        <div className="text-sm">{data?.title} {data?.uses_dates !== false && `· ${dateOnly(data?.date_from)} - ${dateOnly(data?.date_to)}`}</div>
      </div>
      <ErrorBox message={error} />
      {!data ? <Spinner /> : (
        <>
          {data.chart && chartData.length > 0 && (
            <div className="card mb-4 p-4">
              <div className="h-80">
                <ResponsiveContainer>
                  {data.chart.type === "pie" ? (
                    <PieChart>
                      <Pie data={chartData} dataKey={data.chart.y[0]} nameKey="name" outerRadius={120} label={(e) => e.name}>
                        {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => money(v)} />
                      <Legend />
                    </PieChart>
                  ) : data.chart.type === "line" ? (
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      {data.chart.y.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={yLabel(k)} stroke={COLORS[i]} strokeWidth={2} dot={false} />)}
                    </LineChart>
                  ) : (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={chartData.length > 8 ? -30 : 0} textAnchor={chartData.length > 8 ? "end" : "middle"} height={chartData.length > 8 ? 80 : 30} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      {data.chart.y.map((k, i) => <Bar key={k} dataKey={k} name={yLabel(k)} fill={COLORS[i]} radius={[4, 4, 0, 0]} />)}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="card overflow-x-auto">
            {data.rows.length === 0 ? <Empty message="No data for this period." /> : (
              <table className="table-base">
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c.key} className={clsx(["money", "number", "percent", "qty"].includes(c.type) && "text-right")}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i} className={clsx(r.kind === "subtotal" && "bg-slate-50 font-semibold", r.kind === "total" && "bg-brand-50 text-base font-bold", r.kind === "info" && "text-slate-500 italic")}>
                      {data.columns.map((c) => (
                        <td key={c.key} className={clsx("whitespace-nowrap", ["money", "number", "percent", "qty"].includes(c.type) && "text-right", c.type === "money" && Number(r[c.key]) < 0 && "text-red-600")}>
                          {r.kind === "subtotal" && (r[c.key] === null || r[c.key] === undefined) ? "" : fmt(c, r[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {data.totals && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                      {data.columns.map((c, i) => (
                        <td key={c.key} className={clsx("px-3 py-2.5", ["money", "number", "percent", "qty"].includes(c.type) && "text-right")}>
                          {i === 0 ? "Total" : data.totals![c.key] !== undefined ? fmt(c, data.totals![c.key]) : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-400">Amounts in {settings?.currency}. {data.uses_dates !== false && `Period ${dateOnly(data.date_from)} - ${dateOnly(data.date_to)}.`}</p>
        </>
      )}
    </div>
  );
}
