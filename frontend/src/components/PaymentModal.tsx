"use client";

import { Banknote, CreditCard, Loader2, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { Order } from "@/lib/types";
import { Modal, useToast } from "./ui";

type Method = "cash" | "card" | "online";
interface Row {
  method: Method;
  amount: string;
  reference: string;
}

const METHODS: { key: Method; label: string; icon: React.ElementType }[] = [
  { key: "cash", label: "Cash", icon: Banknote },
  { key: "card", label: "Card", icon: CreditCard },
  { key: "online", label: "Online / Wallet", icon: Smartphone },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function PaymentModal({
  order,
  open,
  onClose,
  onPaid,
}: {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onPaid: (o: Order) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const due = order?.balance_due ?? 0;

  useEffect(() => {
    if (open && order) {
      setRows([{ method: "cash", amount: order.balance_due.toFixed(2), reference: "" }]);
      setTendered("");
    }
  }, [open, order]);

  const entered = useMemo(() => round2(rows.reduce((s, r) => s + Math.max(parseFloat(r.amount) || 0, 0), 0)), [rows]);
  const remaining = round2(due - entered);
  const cashAmount = rows.filter((r) => r.method === "cash").reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const change = tendered ? round2((parseFloat(tendered) || 0) - cashAmount) : 0;

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRow = (method: Method) => {
    setRows((rs) => [...rs, { method, amount: remaining > 0 ? remaining.toFixed(2) : "0", reference: "" }]);
  };

  const submit = async () => {
    if (!order) return;
    if (rows.some((r) => (parseFloat(r.amount) || 0) < 0)) {
      toast("Payment amounts cannot be negative", "error");
      return;
    }
    if (Math.abs(remaining) > 0.004) {
      toast(remaining > 0 ? `Still ${money(remaining)} remaining` : `Payments exceed due by ${money(-remaining)}`, "error");
      return;
    }
    if (tendered && change < 0) {
      toast("Cash tendered is less than the cash amount", "error");
      return;
    }
    setBusy(true);
    try {
      const payments = rows
        .filter((r) => parseFloat(r.amount) > 0)
        .map((r) => ({ method: r.method, amount: round2(parseFloat(r.amount)), reference: r.reference }));
      const res = await api.post<Order>(`/orders/${order.id}/complete`, { payments });
      toast(`Order ${res.order_no} paid & closed${change > 0 ? ` - give change ${money(change)}` : ""}`);
      onPaid(res);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Payment - ${order?.order_no ?? ""}`}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-success" onClick={submit} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />} Complete Payment
          </button>
        </>
      }
    >
      {order && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Bill total</div>
              <div className="text-lg font-bold">{money(order.total)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Already paid</div>
              <div className="text-lg font-bold">{money(order.paid_amount)}</div>
            </div>
            <div className="rounded-lg bg-brand-50 p-3">
              <div className="text-xs text-brand-700">Balance due</div>
              <div className="text-lg font-bold text-brand-700">{money(due)}</div>
            </div>
          </div>

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className="input w-36" value={r.method} onChange={(e) => update(i, { method: e.target.value as Method })}>
                  {METHODS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input w-32"
                  type="number"
                  min="0"
                  step="0.01"
                  value={r.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                  aria-label="Amount"
                />
                {r.method !== "cash" && (
                  <input
                    className="input flex-1"
                    placeholder="Ref / last 4 digits"
                    value={r.reference}
                    onChange={(e) => update(i, { reference: e.target.value })}
                  />
                )}
                {rows.length > 1 && (
                  <button className="btn-ghost btn-sm text-red-600" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} aria-label="Remove">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="self-center text-xs text-slate-500">Split with:</span>
            {METHODS.map((m) => (
              <button key={m.key} className="btn-secondary btn-sm" onClick={() => addRow(m.key)}>
                <m.icon size={14} /> {m.label}
              </button>
            ))}
          </div>
          <div className={`text-sm font-medium ${Math.abs(remaining) < 0.005 ? "text-emerald-600" : "text-red-600"}`}>
            {Math.abs(remaining) < 0.005 ? "Fully covered" : remaining > 0 ? `Remaining: ${money(remaining)}` : `Over by ${money(-remaining)}`}
          </div>

          {cashAmount > 0 && (
            <div className="rounded-lg border border-slate-200 p-3">
              <label className="label">Cash tendered by customer</label>
              <div className="flex items-center gap-3">
                <input className="input w-40" type="number" min="0" value={tendered} onChange={(e) => setTendered(e.target.value)} />
                {[500, 1000, 5000].map((n) => (
                  <button key={n} className="btn-secondary btn-sm" onClick={() => setTendered(String(n))}>
                    {n}
                  </button>
                ))}
              </div>
              {tendered && (
                <div className={`mt-2 text-lg font-bold ${change >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  Change: {money(change)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
