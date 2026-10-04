"use client";

import clsx from "clsx";
import { Ban, BellOff, BellRing, CheckCheck, Flame, HandPlatter, Maximize, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Empty, ErrorBox, Modal, PageHeader, Spinner, StatusBadge, Toggle, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { minutesSince, ORDER_TYPE_LABEL, timeOnly } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { KitchenTicket, MenuItem, OrderItem } from "@/lib/types";

export default function KitchenPage() {
  const toast = useToast();
  const [showReady, setShowReady] = useState(true);
  const { data, error, reload, loading } = useApi<KitchenTicket[]>("/kitchen/tickets", { include_ready: showReady }, { refreshMs: 10000 });
  const [sound, setSound] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [, tick] = useState(0);

  // chime when a ticket we have not seen before shows up
  useEffect(() => {
    if (!data) return;
    const keys = new Set(data.map((t) => `${t.order_id}-${t.kot_no}`));
    const isNew = seen.current !== null && [...keys].some((k) => !seen.current!.has(k));
    seen.current = keys;
    if (isNew && sound && audioRef.current) chime(audioRef.current);
  }, [data, sound]);

  const toggleSound = () => {
    if (!sound) {
      // audio can only start after a user gesture, so create the context here
      audioRef.current ??= new AudioContext();
      audioRef.current.resume();
      chime(audioRef.current);
    }
    setSound(!sound);
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast("Fullscreen not available", "error"));
  };
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
            <button className={sound ? "btn-primary" : "btn-secondary"} onClick={toggleSound} title="Chime on new tickets">
              {sound ? <BellRing size={16} /> : <BellOff size={16} />} Sound {sound ? "on" : "off"}
            </button>
            <button className="btn-secondary" onClick={() => setAvailOpen(true)} title="Mark items sold out">
              <Ban size={16} /> Sold out
            </button>
            <button className="btn-secondary" onClick={fullscreen} title="Fullscreen">
              <Maximize size={16} />
            </button>
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
      <AvailabilityModal open={availOpen} onClose={() => setAvailOpen(false)} />
    </div>
  );
}

/** Quick "86" list: kitchen marks dishes unavailable so the POS stops selling them. */
function AvailabilityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<MenuItem[]>(open ? "/menu/items" : null);
  const [q, setQ] = useState("");
  const toggle = async (m: MenuItem) => {
    try {
      await api.patch(`/menu/items/${m.id}/availability`, undefined, { is_available: !m.is_available });
      toast(`${m.name} ${m.is_available ? "marked SOLD OUT" : "available again"}`, m.is_available ? "info" : "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const items = (data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const soldOut = (data ?? []).filter((m) => !m.is_available).length;
  return (
    <Modal open={open} onClose={onClose} title={`Menu availability · ${soldOut} sold out`} size="lg">
      <input className="input mb-3" placeholder="Search dish" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {!data ? (
        <Spinner />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((m) => (
            <button
              key={m.id}
              onClick={() => toggle(m)}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${m.is_available ? "border-slate-200 hover:bg-slate-50" : "border-red-300 bg-red-50 text-red-700"}`}
            >
              <span>
                <span className="font-medium">{m.name}</span>
                <span className="block text-xs text-slate-500">{m.category_name}</span>
              </span>
              <span className="text-xs font-bold">{m.is_available ? "AVAILABLE" : "SOLD OUT"}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, now + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.4);
  });
}
