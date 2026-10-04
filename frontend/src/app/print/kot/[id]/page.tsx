"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dateTime, ORDER_TYPE_LABEL } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Order } from "@/lib/types";

export default function KotPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Kot />
    </Suspense>
  );
}

function Kot() {
  const { id } = useParams<{ id: string }>();
  const kotParam = useSearchParams().get("kot");
  const { user, loading } = useAuth();
  const { data: order, error } = useApi<Order>(user ? `/orders/${id}` : null);

  useEffect(() => {
    if (order) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [order]);

  if (!loading && !user) return <p className="p-6">Please sign in first.</p>;
  if (error) return <p className="p-6 text-red-600">{error}</p>;
  if (!order) return <Spinner />;

  const kots = Array.from(new Set(order.items.filter((i) => i.kot_no).map((i) => i.kot_no as number)));
  const kot = kotParam ? Number(kotParam) : Math.max(0, ...kots);
  const items = order.items.filter((i) => i.kot_no === kot);

  return (
    <div className="mx-auto w-[300px] p-3 font-mono text-[13px] text-black">
      <div className="text-center text-base font-bold">KITCHEN ORDER TICKET</div>
      <div className="my-2 border-t border-dashed border-black" />
      <div>
        {order.order_no} · KOT #{kot || "-"}
      </div>
      <div>
        {ORDER_TYPE_LABEL[order.order_type]}
        {order.table_name ? ` · TABLE ${order.table_name}` : ""}
      </div>
      <div>{dateTime(items[0]?.sent_at ?? order.created_at)}</div>
      <div className="my-2 border-t border-dashed border-black" />
      {items.length === 0 && <div>No items have been sent to the kitchen yet.</div>}
      {items.map((i) => (
        <div key={i.id} className={`mb-1 ${i.status === "cancelled" ? "line-through" : ""}`}>
          <span className="text-base font-bold">{i.quantity} × </span>
          {i.name}
          {i.notes && <div className="pl-5 text-[12px]">** {i.notes}</div>}
        </div>
      ))}
      {order.notes && (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <div>Note: {order.notes}</div>
        </>
      )}
      <div className="no-print mt-6 flex flex-wrap justify-center gap-2 font-sans">
        {kots.map((k) => (
          <a key={k} className="btn-secondary btn-sm" href={`?kot=${k}`}>
            KOT #{k}
          </a>
        ))}
        <button className="btn-primary btn-sm" onClick={() => window.print()}>
          Print
        </button>
      </div>
    </div>
  );
}
