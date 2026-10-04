"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dateTime, money, ORDER_TYPE_LABEL, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Order } from "@/lib/types";

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { settings, user, loading } = useAuth();
  const { data: order, error } = useApi<Order>(user ? `/orders/${id}` : null);

  useEffect(() => {
    if (order && settings) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [order, settings]);

  if (!loading && !user) return <p className="p-6">Please sign in first.</p>;
  if (error) return <p className="p-6 text-red-600">{error}</p>;
  if (!order || !settings) return <Spinner />;

  const items = order.items.filter((i) => i.status !== "cancelled");
  return (
    <div className="mx-auto w-[300px] p-3 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <div className="text-base font-bold">{settings.restaurant_name}</div>
        {settings.address && <div>{settings.address}</div>}
        {settings.phone && <div>Tel: {settings.phone}</div>}
        <div className="my-2 border-t border-dashed border-black" />
        <div className="font-bold">{order.status === "completed" ? "SALES RECEIPT" : "BILL (UNPAID)"}</div>
      </div>
      <div className="mt-1">
        <div>Order: {order.order_no}</div>
        <div>Date: {dateTime(order.created_at)}</div>
        <div>
          Type: {ORDER_TYPE_LABEL[order.order_type]}
          {order.table_name ? ` - Table ${order.table_name}` : ""}
        </div>
        {order.order_type === "dine_in" && <div>Guests: {order.guests}</div>}
        {order.customer_name && <div>Customer: {order.customer_name}</div>}
        {order.customer_phone && <div>Phone: {order.customer_phone}</div>}
        {order.delivery_address && <div>Address: {order.delivery_address}</div>}
        {order.created_by_name && <div>Served by: {order.created_by_name}</div>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left">Item</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="pr-1 align-top">
                {i.name}
                <div className="text-[10px]">@ {money(i.unit_price, false)}</div>
              </td>
              <td className="text-right align-top">{i.quantity}</td>
              <td className="text-right align-top">{money(i.line_total, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-2 border-t border-dashed border-black" />
      <Line label="Subtotal" value={money(order.subtotal, false)} />
      {order.discount_amount > 0 && (
        <Line label={`Discount${order.discount_type === "percent" ? ` (${order.discount_value}%)` : ""}`} value={`-${money(order.discount_amount, false)}`} />
      )}
      {order.service_charge > 0 && <Line label={`Service (${settings.service_charge_rate}%)`} value={money(order.service_charge, false)} />}
      {order.tax_amount > 0 && <Line label={`Tax (${settings.tax_rate}%)`} value={money(order.tax_amount, false)} />}
      {order.delivery_fee > 0 && <Line label="Delivery fee" value={money(order.delivery_fee, false)} />}
      <div className="my-1 border-t border-black" />
      <Line label="TOTAL" value={money(order.total)} bold />
      {order.payments.map((p) => (
        <Line key={p.id} label={`Paid (${titleCase(p.method)})`} value={money(p.amount, false)} />
      ))}
      {order.balance_due > 0 && <Line label="Balance due" value={money(order.balance_due, false)} bold />}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">{settings.receipt_footer}</div>
      <div className="no-print mt-6 flex justify-center gap-2 font-sans">
        <button className="btn-primary" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn-secondary" onClick={() => window.close()}>
          Close
        </button>
      </div>
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "text-sm font-bold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
