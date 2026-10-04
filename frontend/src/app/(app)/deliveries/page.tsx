"use client";

import { Bike, CheckCircle2, Eye, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, StatusBadge, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { isoDate, minutesSince, money, timeOnly } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { OrderListItem } from "@/lib/types";

const COLUMNS: { key: "pending" | "dispatched" | "delivered"; title: string }[] = [
  { key: "pending", title: "Preparing / Pending" },
  { key: "dispatched", title: "Out for delivery" },
  { key: "delivered", title: "Delivered today" },
];

export default function DeliveriesPage() {
  const toast = useToast();
  const active = useApi<OrderListItem[]>(
    "/orders",
    { order_type: "delivery", status: "open,completed", delivery_status: "pending,dispatched", limit: 500 },
    { refreshMs: 15000 },
  );
  const done = useApi<OrderListItem[]>(
    "/orders",
    { order_type: "delivery", delivery_status: "delivered", date_from: isoDate(), date_to: isoDate(), limit: 500 },
    { refreshMs: 15000 },
  );
  const reload = () => {
    active.reload();
    done.reload();
  };
  const list = active.data && done.data ? [...active.data, ...done.data] : null;
  const error = active.error || done.error;
  const [dispatch, setDispatch] = useState<OrderListItem | null>(null);
  const [rider, setRider] = useState("");

  const setStatus = async (o: OrderListItem, delivery_status: string, rider_name?: string) => {
    try {
      await api.post(`/orders/${o.id}/delivery-status`, { delivery_status, rider_name });
      toast(`${o.order_no} marked ${delivery_status}`);
      setDispatch(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const orders = list ?? [];

  return (
    <div>
      <PageHeader title="Deliveries" subtitle="Track delivery orders from kitchen to doorstep" actions={<Link href="/pos?type=delivery" className="btn-primary"><Bike size={16} /> New delivery</Link>} />
      <ErrorBox message={error} />
      {!list && <Spinner />}
      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = orders.filter((o) => o.delivery_status === col.key);
          return (
            <div key={col.key} className="rounded-xl bg-slate-200/60 p-3">
              <h3 className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-600">
                {col.title} <span className="rounded-full bg-white px-2 text-xs">{items.length}</span>
              </h3>
              <div className="space-y-3">
                {items.length === 0 && <Empty message="None" />}
                {items.map((o) => {
                  return (
                    <div key={o.id} className="card p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-semibold">{o.customer_name || "Customer"}</div>
                          <div className="flex items-center gap-1 text-xs text-slate-500"><Phone size={11} />{o.customer_phone}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{money(o.total)}</div>
                          <StatusBadge status={o.paid_amount >= o.total ? "completed" : "open"} />
                        </div>
                      </div>
                      {o.delivery_address && <div className="mt-1 flex items-start gap-1 text-xs text-slate-600"><MapPin size={12} className="mt-0.5" />{o.delivery_address}</div>}
                      {o.rider_name && <div className="mt-1 text-xs text-slate-600">Rider: <b>{o.rider_name}</b></div>}
                      <div className="mt-1 text-xs text-slate-400">{o.order_no} · {timeOnly(o.created_at)} · {minutesSince(o.created_at)} min ago</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Link href={`/pos?order=${o.id}`} className="btn-secondary btn-sm"><Eye size={13} /> Open</Link>
                        {o.delivery_status === "pending" && (
                          <button className="btn-primary btn-sm" onClick={() => { setRider(o.rider_name); setDispatch(o); }}><Bike size={13} /> Dispatch</button>
                        )}
                        {o.delivery_status === "dispatched" && (
                          <button className="btn-success btn-sm" onClick={() => setStatus(o, "delivered")}><CheckCircle2 size={13} /> Delivered</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <Modal open={!!dispatch} onClose={() => setDispatch(null)} title={`Dispatch ${dispatch?.order_no ?? ""}`} size="sm" footer={<button className="btn-primary" disabled={!rider.trim()} onClick={() => dispatch && setStatus(dispatch, "dispatched", rider)}>Dispatch</button>}>
        <Field label="Rider name"><input className="input" autoFocus value={rider} onChange={(e) => setRider(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
