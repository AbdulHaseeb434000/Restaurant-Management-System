"use client";

import clsx from "clsx";
import { CheckCheck, Flame, HandPlatter, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty, ErrorBox, PageHeader, Spinner, StatusBadge, Toggle, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { minutesSince, ORDER_TYPE_LABEL, timeOnly } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { KitchenTicket, OrderItem } from "@/lib/types";

export default function KitchenPage() {
  const toast = useToast();
  const [showReady, setShowReady] = useState(true);
  const { data, error, reload, loading } = useApi<KitchenTicket[]>("/kitchen/tickets", { include_ready: showReady }, { refreshMs: 10000 });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const setTicket = async (t: KitchenTicket, status: "preparing" | "ready" | "served") => {
    try {
      await api.patch(`/kitchen/tickets/${t.order_id}/${t.kot_no}`, { status });
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const setItem = async (i: OrderItem, status: "preparing" | "ready" | "served") => {
    try {
      await api.patch(`/kitchen/items/${i.id}`, { status });
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const next = (s: OrderItem["status"]) => (s === "sent" ? "preparing" : s === "preparing" ? "ready" : "served") as "preparing" | "ready" | "served";

  return (
    <div>
      <PageHeader
        title="Kitchen Display"
        subtitle="Tickets refresh automatically every 10 seconds. Tap an item to move it to the next stage."
        actions={
          <>
            <Toggle label="Show ready" checked={showReady} onChange={setShowReady} />
            <button className="btn-secondary" onClick={reload} disabled={loading}>
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </>
        }
      />
      <ErrorBox message={error} />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <div className="card"><Empty message="No pending tickets. 🎉" /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.map((t) => {
            const age = minutesSince(t.sent_at);
            const allReady = t.items.every((i) => i.status === "ready");
            return (
              <div
                key={`${t.order_id}-${t.kot_no}`}
                className={clsx(
                  "card flex flex-col overflow-hidden border-t-4",
                  allReady ? "border-t-emerald-500" : age >= 20 ? "border-t-red-500" : age >= 10 ? "border-t-amber-500" : "border-t-sky-500",
                )}
              >
                <div className="flex items-start justify-between border-b border-slate-100 p-3">
                  <div>
                    <div className="text-lg font-bold">
                      {t.table_name ? `Table ${t.table_name}` : ORDER_TYPE_LABEL[t.order_type]}
                    </div>
                    <div className="text-xs text-slate-500">
                      {t.order_no} · KOT #{t.kot_no} {t.customer_name && `· ${t.customer_name}`}
                    </div>
                  </div>
                  <div className={clsx("text-right text-sm font-semibold", age >= 20 ? "text-red-600" : age >= 10 ? "text-amber-600" : "text-slate-600")}>
                    {age} min
                    <div className="text-xs font-normal text-slate-400">{timeOnly(t.sent_at)}</div>
                  </div>
                </div>
                <ul className="flex-1 divide-y divide-slate-100">
                  {t.items.map((i) => (
                    <li key={i.id}>
                      <button className="flex w-full items-start gap-2 p-3 text-left hover:bg-slate-50" onClick={() => setItem(i, next(i.status))} title="Advance status">
                        <span className="text-lg font-bold">{i.quantity}×</span>
                        <span className="flex-1">
                          <span className={clsx("font-medium", i.status === "ready" && "text-emerald-700")}>{i.name}</span>
                          {i.notes && <span className="block text-xs font-semibold text-red-600">** {i.notes}</span>}
                        </span>
                        <StatusBadge status={i.status} />
                      </button>
                    </li>
                  ))}
                </ul>
                {t.notes && <div className="bg-amber-50 px-3 py-2 text-xs text-amber-800">Note: {t.notes}</div>}
                <div className="grid grid-cols-3 gap-1 border-t border-slate-100 p-2">
                  <button className="btn-secondary btn-sm" onClick={() => setTicket(t, "preparing")}><Flame size={14} /> Start</button>
                  <button className="btn-success btn-sm" onClick={() => setTicket(t, "ready")}><CheckCheck size={14} /> Ready</button>
                  <button className="btn-secondary btn-sm" onClick={() => setTicket(t, "served")}><HandPlatter size={14} /> Served</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
