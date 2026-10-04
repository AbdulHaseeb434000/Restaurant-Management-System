"use client";

import clsx from "clsx";
import {
  ArrowRightLeft,
  Ban,
  ChefHat,
  CreditCard,
  LayoutGrid,
  ListOrdered,
  Minus,
  Percent,
  Plus,
  Printer,
  Save,
  Search,
  ShoppingBag,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PaymentModal from "@/components/PaymentModal";
import { Badge, Field, Modal, NumberStepper, PromptDialog, Spinner, StatusBadge, useConfirm, usePageTitle, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { minutesSince, money, ORDER_TYPE_LABEL } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Customer, DiningTable, MenuCategory, MenuItem, Order, OrderItem, OrderListItem, OrderType } from "@/lib/types";

interface DraftLine {
  key: string;
  menu_item_id: number;
  name: string;
  price: number;
  quantity: number;
  notes: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function POSPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <POS />
    </Suspense>
  );
}

function POS() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { settings, hasRole } = useAuth();
  const canCash = hasRole("manager", "cashier");

  const orderId = params.get("order");
  const [order, setOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  // new-order header
  const [orderType, setOrderType] = useState<OrderType>((params.get("type") as OrderType) || (params.get("table") ? "dine_in" : "takeaway"));
  const [tableId, setTableId] = useState<number | null>(params.get("table") ? Number(params.get("table")) : null);
  const [guests, setGuests] = useState(2);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [orderNotes, setOrderNotes] = useState("");

  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [category, setCategory] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  // dialogs
  const [payOpen, setPayOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [voidLine, setVoidLine] = useState<OrderItem | null>(null);
  const [noteLine, setNoteLine] = useState<DraftLine | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data: categories } = useApi<MenuCategory[]>("/menu/categories");
  const { data: menu } = useApi<MenuItem[]>("/menu/items");
  const { data: tables, reload: reloadTables } = useApi<DiningTable[]>("/tables");
  const { data: openOrders, reload: reloadOpen } = useApi<OrderListItem[]>("/orders", { status: "open", limit: 200 }, { refreshMs: 20000 });
  const [openListOpen, setOpenListOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadOrder = useCallback(async (id: string | number) => {
    setLoadingOrder(true);
    try {
      setOrder(await api.get<Order>(`/orders/${id}`));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoadingOrder(false);
    }
  }, [toast]);

  useEffect(() => {
    setDraft([]);
    if (orderId) loadOrder(orderId);
    else setOrder(null);
  }, [orderId, loadOrder]);

  usePageTitle(order ? `POS · ${order.order_no}` : "POS");

  // keyboard: "/" or F2 focuses menu search, Esc clears it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if ((e.key === "/" && !typing) || e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // warn before closing the tab with items that were never saved
  useEffect(() => {
    if (!draft.length) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [draft.length]);

  const type: OrderType = order?.order_type ?? orderType;
  const editable = !order || order.status === "open";

  const visibleMenu = useMemo(() => {
    const flag = { dine_in: "available_dine_in", takeaway: "available_takeaway", delivery: "available_delivery" }[type] as keyof MenuItem;
    const q = search.trim().toLowerCase();
    return (menu ?? []).filter(
      (m) =>
        m[flag] &&
        (category === "all" || m.category_id === category) &&
        (!q || m.name.toLowerCase().includes(q) || (m.code ?? "").toLowerCase().includes(q)),
    );
  }, [menu, category, search, type]);

  // quantity already on this order per menu item, shown as a badge on the menu tile
  const inCart = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of order?.items ?? []) if (i.status !== "cancelled") m.set(i.menu_item_id, (m.get(i.menu_item_id) ?? 0) + i.quantity);
    for (const l of draft) m.set(l.menu_item_id, (m.get(l.menu_item_id) ?? 0) + l.quantity);
    return m;
  }, [order, draft]);

  const selectedTable = (tables ?? []).find((t) => t.id === tableId) ?? null;


  // ------------------------------------------------------------------ totals preview
  const totals = useMemo(() => {
    const serverSub = order ? order.subtotal : 0;
    const draftSub = draft.reduce((s, l) => s + l.price * l.quantity, 0);
    const subtotal = serverSub + draftSub;
    let discount = 0;
    if (order) discount = order.discount_type === "percent" ? (subtotal * order.discount_value) / 100 : order.discount_value;
    discount = Math.min(discount, subtotal);
    const net = subtotal - discount;
    const service = type === "dine_in" ? round2((net * (settings?.service_charge_rate ?? 0)) / 100) : 0;
    const tax = round2(((net + service) * (settings?.tax_rate ?? 0)) / 100);
    const delivery = type === "delivery" ? (order ? order.delivery_fee : settings?.default_delivery_fee ?? 0) : 0;
    const total = round2(net + service + tax + delivery);
    return { subtotal: round2(subtotal), discount: round2(discount), service, tax, delivery, total, paid: order?.paid_amount ?? 0 };
  }, [order, draft, settings, type]);

  // ------------------------------------------------------------------ cart ops
  const addToDraft = (m: MenuItem) => {
    if (!editable) return;
    if (!m.is_available) {
      toast(`${m.name} is unavailable`, "error");
      return;
    }
    setDraft((d) => {
      const idx = d.findIndex((l) => l.menu_item_id === m.id && !l.notes);
      if (idx >= 0) return d.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      return [...d, { key: `${m.id}-${Date.now()}`, menu_item_id: m.id, name: m.name, price: m.price, quantity: 1, notes: "" }];
    });
  };

  const changeDraftQty = (key: string, delta: number) =>
    setDraft((d) => d.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0));

  const run = async (fn: () => Promise<Order>, success?: string) => {
    setBusy(true);
    try {
      const o = await fn();
      setOrder(o);
      reloadOpen();
      if (success) toast(success);
      return o;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const draftPayload = () => draft.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity, notes: l.notes }));

  /** Persist draft lines (creating the order if needed). Returns the saved order. */
  const save = async (sendToKitchen: boolean): Promise<Order | null> => {
    if (order) {
      if (!draft.length) {
        if (!sendToKitchen) return order;
        if (!order.items.some((i) => i.status === "new")) {
          toast("Nothing new to send to the kitchen", "info");
          return order;
        }
        return run(() => api.post<Order>(`/orders/${order.id}/send-to-kitchen`), "Sent to kitchen");
      }
      const o = await run(
        () => api.post<Order>(`/orders/${order.id}/items`, { items: draftPayload(), send_to_kitchen: sendToKitchen }),
        sendToKitchen ? "Items sent to kitchen" : "Order updated",
      );
      if (o) setDraft([]);
      return o;
    }
    if (type === "dine_in" && !tableId) {
      toast("Select a table for dine-in", "error");
      return null;
    }
    if (type === "delivery" && (!customerPhone.trim() || !address.trim())) {
      toast("Delivery needs customer phone and address", "error");
      setDetailsOpen(true);
      return null;
    }
    const o = await run(
      () =>
        api.post<Order>("/orders", {
          order_type: type,
          table_id: type === "dine_in" ? tableId : null,
          guests,
          customer_name: customerName,
          customer_phone: customerPhone,
          delivery_address: type === "delivery" ? address : "",
          notes: orderNotes,
          items: draftPayload(),
          send_to_kitchen: sendToKitchen,
        }),
      sendToKitchen ? "Order placed & sent to kitchen" : "Order saved",
    );
    if (o) {
      setDraft([]);
      router.replace(`/pos?order=${o.id}`);
      reloadTables();
      reloadOpen();
    }
    return o;
  };

  const openPayment = async () => {
    const o = draft.length || !order ? await save(false) : order;
    if (o) setPayOpen(true);
  };

  const discardDraftOk = async () =>
    !draft.length ||
    (await confirm({ title: "Discard unsaved items?", message: `${draft.length} item line(s) were not saved to the order.`, confirmText: "Discard", danger: true }));

  const goToOrder = async (id: number) => {
    if (!(await discardDraftOk())) return;
    setOpenListOpen(false);
    router.push(`/pos?order=${id}`);
  };

  const newOrder = async () => {
    if (!(await discardDraftOk())) return;
    setDraft([]);
    setOrder(null);
    setCustomerName("");
    setCustomerPhone("");
    setAddress("");
    setOrderNotes("");
    setTableId(null);
    router.replace("/pos");
    reloadTables();
    reloadOpen();
  };

  const lookupCustomer = async () => {
    if (!customerPhone.trim()) return;
    try {
      const c = await api.get<Customer>(`/customers/by-phone/${encodeURIComponent(customerPhone.trim())}`);
      setCustomerName(c.name);
      if (c.address) setAddress(c.address);
      toast(`Found ${c.name} (${c.order_count} previous orders)`, "info");
    } catch {
      toast("New customer - will be saved with the order", "info");
    }
  };

  if (loadingOrder && !order) return <Spinner />;

  const activeLines = order?.items ?? [];
  const voidedTotal = activeLines.filter((i) => i.status === "cancelled").reduce((sum, i) => sum + i.line_total, 0);
  const lineCount = activeLines.filter((i) => i.status !== "cancelled").length + draft.length;

  return (
    <div className="-m-4 flex h-[calc(100vh-49px)] flex-col lg:-m-6 lg:h-screen lg:flex-row">
      {/* ================================================= MENU */}
      <section className="flex min-h-0 flex-1 flex-col border-r border-slate-200 bg-slate-50">
        <div className="space-y-3 border-b border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                className="input pl-9"
                placeholder="Search menu by name or code…  ( / )"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearch("");
                  if (e.key === "Enter" && visibleMenu.length === 1) {
                    addToDraft(visibleMenu[0]);
                    setSearch("");
                  }
                }}
              />
            </div>
            <button className="btn-secondary whitespace-nowrap" onClick={() => setOpenListOpen(true)} title="Open / held orders">
              <ListOrdered size={16} /> Open
              <span className="rounded-full bg-brand-100 px-1.5 text-xs font-bold text-brand-700">{openOrders?.length ?? 0}</span>
            </button>
            <button className="btn-secondary" onClick={newOrder}>
              <Plus size={16} /> New
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button className={clsx("btn-sm whitespace-nowrap", category === "all" ? "btn-primary" : "btn-secondary")} onClick={() => setCategory("all")}>
              All
            </button>
            {(categories ?? []).map((c) => (
              <button
                key={c.id}
                className={clsx("btn-sm whitespace-nowrap", category === c.id ? "btn-primary" : "btn-secondary")}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {!menu && <Spinner className="col-span-full" />}
          {visibleMenu.map((m) => (
            <button
              key={m.id}
              onClick={() => addToDraft(m)}
              disabled={!editable || !m.is_available}
              className={clsx(
                "card relative flex h-24 flex-col justify-between p-3 text-left transition hover:border-brand-400 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed",
                !m.is_available && "opacity-50",
                inCart.has(m.id) && "border-brand-300 bg-brand-50/40",
              )}
            >
              {inCart.has(m.id) && (
                <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white shadow">
                  {inCart.get(m.id)}
                </span>
              )}
              <span className="line-clamp-2 pr-2 text-sm font-medium leading-tight">{m.name}</span>
              <span className="flex items-center justify-between text-sm">
                <span className="font-bold text-brand-700">{money(m.price)}</span>
                {!m.is_available && <Badge color="red">86</Badge>}
              </span>
            </button>
          ))}
          {menu && visibleMenu.length === 0 && <p className="col-span-full p-6 text-center text-sm text-slate-400">No items match.</p>}
        </div>
      </section>

      {/* ================================================= ORDER PANEL */}
      <section className="flex min-h-0 w-full flex-col bg-white lg:w-[420px]">
        {/* header */}
        <div className="space-y-2 border-b border-slate-200 p-3">
          {order ? (
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">{order.order_no}</h2>
                  <StatusBadge status={order.status} />
                </div>
                <div className="text-sm text-slate-500">
                  {ORDER_TYPE_LABEL[order.order_type]}
                  {order.table_name && ` · Table ${order.table_name} · ${order.guests} guests`}
                  {order.customer_name && ` · ${order.customer_name}`}
                  {order.customer_phone && ` (${order.customer_phone})`}
                </div>
                {order.delivery_address && <div className="text-xs text-slate-500">{order.delivery_address}</div>}
              </div>
              {editable && (
                <button className="btn-ghost btn-sm" onClick={() => setDetailsOpen(true)} title="Edit details">
                  <StickyNote size={16} />
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                {(["dine_in", "takeaway", "delivery"] as OrderType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    className={clsx("rounded-md py-1.5 text-sm font-medium", orderType === t ? "bg-white shadow text-brand-700" : "text-slate-600")}
                  >
                    {ORDER_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              {orderType === "dine_in" && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={clsx("btn flex-1 justify-start border py-2.5", selectedTable ? "border-brand-400 bg-brand-50 text-brand-800" : "border-dashed border-slate-400 text-slate-500 hover:bg-slate-50")}
                    onClick={() => setTablePickerOpen(true)}
                  >
                    <LayoutGrid size={16} />
                    {selectedTable ? `Table ${selectedTable.name} · ${selectedTable.capacity} seats` : "Tap to choose a table"}
                  </button>
                  <NumberStepper value={guests} onChange={setGuests} min={1} max={99} label="guests" />
                </div>
              )}
              {orderType !== "dine_in" && (
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} onBlur={lookupCustomer} />
                  <input className="input" placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                  {orderType === "delivery" && (
                    <textarea className="input col-span-2" rows={2} placeholder="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* lines */}
        <div className="flex-1 overflow-y-auto">
          {lineCount === 0 && (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-sm text-slate-400">
              <ShoppingBag size={36} className="mb-2" />
              Tap menu items to add them to the order.
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {activeLines.map((l) => (
              <li key={l.id} className={clsx("flex items-start gap-2 px-3 py-2", l.status === "cancelled" && "opacity-50")}>
                <div className="min-w-0 flex-1">
                  <div className={clsx("text-sm font-medium", l.status === "cancelled" && "line-through")}>
                    {l.quantity} × {l.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <StatusBadge status={l.status} />
                    {l.kot_no && <span>KOT #{l.kot_no}</span>}
                    {l.notes && <span className="italic">“{l.notes}”</span>}
                    {l.cancel_reason && <span className="text-red-500">{l.cancel_reason}</span>}
                  </div>
                </div>
                {l.status === "cancelled" ? (
                  <div className="text-right text-sm">
                    <div className="text-slate-400 line-through">{money(l.line_total, false)}</div>
                    <div className="text-[10px] font-semibold uppercase text-red-500">void · not charged</div>
                  </div>
                ) : (
                  <div className="text-right text-sm font-medium">{money(l.line_total, false)}</div>
                )}
                {editable && l.status === "new" && (
                  <div className="flex items-center gap-0.5">
                    <button
                      className="btn-ghost btn-sm px-1.5"
                      aria-label="Decrease"
                      disabled={busy}
                      onClick={() =>
                        l.quantity > 1
                          ? run(() => api.patch<Order>(`/orders/${order!.id}/items/${l.id}`, { quantity: l.quantity - 1 }))
                          : run(() => api.del<Order>(`/orders/${order!.id}/items/${l.id}`))
                      }
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      className="btn-ghost btn-sm px-1.5"
                      aria-label="Increase"
                      disabled={busy}
                      onClick={() => run(() => api.patch<Order>(`/orders/${order!.id}/items/${l.id}`, { quantity: l.quantity + 1 }))}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                )}
                {editable && canCash && l.status !== "new" && l.status !== "cancelled" && (
                  <button className="btn-ghost btn-sm px-1.5 text-red-600" title="Void item" onClick={() => setVoidLine(l)}>
                    <Undo2 size={14} />
                  </button>
                )}
              </li>
            ))}
            {draft.map((l) => (
              <li key={l.key} className="flex items-start gap-2 bg-brand-50/60 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {l.quantity} × {l.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Badge color="orange">NOT SAVED</Badge>
                    {l.notes && <span className="italic">“{l.notes}”</span>}
                  </div>
                </div>
                <div className="text-right text-sm font-medium">{money(l.price * l.quantity, false)}</div>
                <div className="flex items-center gap-0.5">
                  <button className="btn-ghost btn-sm px-1.5" aria-label="Note" onClick={() => setNoteLine(l)}>
                    <StickyNote size={14} />
                  </button>
                  <button className="btn-ghost btn-sm px-1.5" aria-label="Decrease" onClick={() => changeDraftQty(l.key, -1)}>
                    <Minus size={14} />
                  </button>
                  <button className="btn-ghost btn-sm px-1.5" aria-label="Increase" onClick={() => changeDraftQty(l.key, 1)}>
                    <Plus size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* totals */}
        <div className="border-t border-slate-200 p-3 text-sm">
          {voidedTotal > 0 && <Row label="Voided items (excluded)" value={money(voidedTotal)} className="text-xs text-slate-400" />}
          <Row label="Subtotal" value={money(totals.subtotal)} />
          {totals.discount > 0 && <Row label={`Discount${order?.discount_type === "percent" ? ` (${order.discount_value}%)` : ""}`} value={`- ${money(totals.discount)}`} className="text-emerald-600" />}
          {totals.service > 0 && <Row label={`Service charge (${settings?.service_charge_rate}%)`} value={money(totals.service)} />}
          {totals.tax > 0 && <Row label={`Tax (${settings?.tax_rate}%)`} value={money(totals.tax)} />}
          {totals.delivery > 0 && <Row label="Delivery fee" value={money(totals.delivery)} />}
          <Row label="Total" value={money(totals.total)} className="mt-1 border-t border-dashed border-slate-200 pt-1 text-lg font-bold" />
          {order && order.payments.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {order.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-emerald-700">
                  <span>
                    Paid ({p.method}){p.reference && ` · ${p.reference}`}
                  </span>
                  <span className="flex items-center gap-1">
                    {money(p.amount)}
                    {editable && canCash && (
                      <button
                        className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="Remove / refund this payment"
                        disabled={busy}
                        onClick={async () => {
                          if (!(await confirm({ title: `Remove ${p.method} payment of ${money(p.amount)}?`, message: "Use this to correct a payment or to refund the customer.", confirmText: "Remove payment", danger: true }))) return;
                          await run(() => api.del<Order>(`/orders/${order.id}/payments/${p.id}`), "Payment removed");
                        }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {order && order.status === "open" && totals.paid > totals.total + 0.004 && (
            <Row label="Refund due to customer" value={money(totals.paid - totals.total)} className="font-semibold text-red-600" />
          )}
          {order && order.status === "open" && totals.paid > 0 && <Row label="Balance" value={money(Math.max(totals.total - totals.paid, 0))} className="font-semibold" />}
        </div>

        {/* actions */}
        <div className="border-t border-slate-200 p-3">
          {editable ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-secondary" disabled={busy || (!!order && !draft.length)} onClick={() => save(false)}>
                  <Save size={16} /> Save / Hold
                </button>
                <button
                  className="btn bg-sky-600 text-white hover:bg-sky-700"
                  disabled={busy || (!draft.length && !order?.items.some((i) => i.status === "new"))}
                  onClick={() => save(true)}
                >
                  <ChefHat size={16} /> <span className="whitespace-nowrap">Send to Kitchen</span>
                </button>
              </div>
              {canCash && (
                <button className="btn-success mt-2 w-full py-3 text-base" disabled={busy || lineCount === 0} onClick={openPayment}>
                  <CreditCard size={18} /> Pay {money(Math.max(totals.total - totals.paid, 0))}
                </button>
              )}
              {order && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {canCash && (
                    <button className="btn-secondary btn-sm" onClick={() => setDiscountOpen(true)}>
                      <Percent size={14} /> Discount
                    </button>
                  )}
                  {order.order_type === "dine_in" && (
                    <button className="btn-secondary btn-sm" onClick={() => setTransferOpen(true)}>
                      <ArrowRightLeft size={14} /> Transfer
                    </button>
                  )}
                  <Link href={`/print/receipt/${order.id}`} target="_blank" className="btn-secondary btn-sm">
                    <Printer size={14} /> Bill
                  </Link>
                  <Link href={`/print/kot/${order.id}`} target="_blank" className="btn-secondary btn-sm">
                    <Printer size={14} /> KOT
                  </Link>
                  {canCash && (
                    <button className="btn-secondary btn-sm text-red-600" onClick={() => setCancelOpen(true)}>
                      <Ban size={14} /> Cancel
                    </button>
                  )}
                </div>
              )}
              {draft.length > 0 && (
                <button className="btn-ghost btn-sm mt-2 w-full text-red-600" onClick={() => setDraft([])}>
                  <Trash2 size={14} /> Clear unsaved items
                </button>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg bg-slate-50 p-3 text-center text-sm text-slate-600">
                This order is <b>{order?.status}</b>
                {order?.cancel_reason && ` - ${order.cancel_reason}`}.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link href={`/print/receipt/${order!.id}`} target="_blank" className="btn-secondary">
                  <Printer size={16} /> Print Receipt
                </Link>
                <button className="btn-primary" onClick={newOrder}>
                  <Plus size={16} /> New Order
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ================================================= DIALOGS */}
      <Modal open={tablePickerOpen} onClose={() => setTablePickerOpen(false)} title="Choose a table" size="xl">
        {!tables ? (
          <Spinner />
        ) : (
          Array.from(new Set(tables.map((t) => t.area_name ?? "Other"))).map((area) => (
            <div key={area} className="mb-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{area}</div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
                {tables
                  .filter((t) => (t.area_name ?? "Other") === area)
                  .map((t) => {
                    const busy = !!t.open_order_id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setTableId(t.id);
                          setGuests((g) => Math.min(g, t.capacity + 4));
                          setTablePickerOpen(false);
                        }}
                        className={clsx(
                          "flex h-20 flex-col items-center justify-center rounded-xl border-2 text-sm transition active:scale-95",
                          busy && "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400",
                          !busy && t.id === tableId && "border-brand-500 bg-brand-100",
                          !busy && t.id !== tableId && t.status === "available" && "border-emerald-300 bg-emerald-50 hover:bg-emerald-100",
                          !busy && t.id !== tableId && t.status !== "available" && "border-amber-300 bg-amber-50 hover:bg-amber-100",
                        )}
                      >
                        <span className="text-lg font-bold">{t.name}</span>
                        <span className="text-xs">{busy ? "occupied" : t.status === "available" ? `${t.capacity} seats` : t.status}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))
        )}
      </Modal>
      <Modal open={openListOpen} onClose={() => setOpenListOpen(false)} title={`Open orders (${openOrders?.length ?? 0})`} size="lg">
        {!openOrders?.length ? (
          <p className="p-6 text-center text-sm text-slate-400">No open orders.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {openOrders.map((o) => (
              <li key={o.id}>
                <button
                  className={clsx("flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-slate-50", o.id === order?.id && "bg-brand-50")}
                  onClick={() => goToOrder(o.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {o.table_name ? `Table ${o.table_name}` : o.customer_name || o.customer_phone || ORDER_TYPE_LABEL[o.order_type]}
                    </div>
                    <div className="text-xs text-slate-500">
                      {o.order_no} · {ORDER_TYPE_LABEL[o.order_type]} · {o.item_count} items · {minutesSince(o.created_at)} min
                      {o.created_by_name && ` · ${o.created_by_name}`}
                    </div>
                  </div>
                  {o.paid_amount > 0 && <Badge color="green">PART PAID</Badge>}
                  <span className="font-semibold">{money(o.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <PaymentModal
        open={payOpen}
        order={order}
        onClose={() => setPayOpen(false)}
        onPaid={(o) => {
          setOrder(o);
          setPayOpen(false);
          reloadTables();
          reloadOpen();
          window.open(`/print/receipt/${o.id}`, "_blank");
        }}
      />
      <DiscountDialog
        open={discountOpen}
        order={order}
        onClose={() => setDiscountOpen(false)}
        onApply={async (dt, dv) => {
          const o = await run(() => api.post<Order>(`/orders/${order!.id}/discount`, { discount_type: dt, discount_value: dv }), "Discount applied");
          if (o) setDiscountOpen(false);
        }}
      />
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transfer to table" size="sm">
        <div className="grid grid-cols-3 gap-2">
          {(tables ?? [])
            .filter((t) => !t.open_order_id && t.id !== order?.table_id)
            .map((t) => (
              <button
                key={t.id}
                className="btn-secondary flex-col py-3"
                onClick={async () => {
                  const o = await run(() => api.post<Order>(`/orders/${order!.id}/transfer`, { table_id: t.id }), `Moved to ${t.name}`);
                  if (o) {
                    setTransferOpen(false);
                    reloadTables();
                  }
                }}
              >
                <span className="font-bold">{t.name}</span>
                <span className="text-xs text-slate-500">{t.capacity} seats</span>
              </button>
            ))}
        </div>
      </Modal>
      <PromptDialog
        open={cancelOpen}
        title="Cancel order"
        message="The whole order will be cancelled. This cannot be undone."
        requireText
        danger
        confirmText="Cancel Order"
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          const o = await run(() => api.post<Order>(`/orders/${order!.id}/cancel`, { reason }), "Order cancelled");
          if (o) {
            setCancelOpen(false);
            reloadTables();
          }
        }}
      />
      <VoidDialog
        key={voidLine?.id ?? "none"}
        line={voidLine}
        onClose={() => setVoidLine(null)}
        onConfirm={async (reason, quantity) => {
          const o = await run(() => api.post<Order>(`/orders/${order!.id}/items/${voidLine!.id}/void`, { reason, quantity }), "Item voided");
          if (o) setVoidLine(null);
        }}
      />
      <NoteDialog
        line={noteLine}
        onClose={() => setNoteLine(null)}
        onSave={(notes) => {
          setDraft((d) => d.map((l) => (l.key === noteLine!.key ? { ...l, notes } : l)));
          setNoteLine(null);
        }}
      />
      <DetailsDialog
        open={detailsOpen}
        order={order}
        initial={{ customerName, customerPhone, address, notes: orderNotes }}
        onClose={() => setDetailsOpen(false)}
        onSave={async (v) => {
          if (!order) {
            setCustomerName(v.customerName);
            setCustomerPhone(v.customerPhone);
            setAddress(v.address);
            setOrderNotes(v.notes);
            setDetailsOpen(false);
            return;
          }
          const o = await run(
            () =>
              api.put<Order>(`/orders/${order.id}`, {
                customer_name: v.customerName,
                customer_phone: v.customerPhone,
                delivery_address: v.address,
                notes: v.notes,
                guests: v.guests,
              }),
            "Order details updated",
          );
          if (o) setDetailsOpen(false);
        }}
      />
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={clsx("flex justify-between py-0.5", className)}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DiscountDialog({
  open,
  order,
  onClose,
  onApply,
}: {
  open: boolean;
  order: Order | null;
  onClose: () => void;
  onApply: (type: "amount" | "percent", value: number) => Promise<void>;
}) {
  const [dt, setDt] = useState<"amount" | "percent">("percent");
  const [value, setValue] = useState("0");
  useEffect(() => {
    if (open && order) {
      setDt(order.discount_value ? order.discount_type : "percent");
      setValue(String(order.discount_value || 0));
    }
  }, [open, order]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply discount"
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={() => onApply("amount", 0)}>
            Remove discount
          </button>
          <button className="btn-primary" onClick={() => onApply(dt, Number(value) || 0)}>
            Apply
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {(["percent", "amount"] as const).map((t) => (
            <button key={t} onClick={() => setDt(t)} className={clsx("rounded-md py-1.5 text-sm", dt === t ? "bg-white shadow font-semibold" : "")}>
              {t === "percent" ? "Percentage %" : "Flat amount"}
            </button>
          ))}
        </div>
        <input className="input" type="number" min={0} max={dt === "percent" ? 100 : undefined} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        {dt === "percent" && (
          <div className="flex gap-2">
            {[5, 10, 15, 20, 25].map((p) => (
              <button key={p} className="btn-secondary btn-sm" onClick={() => setValue(String(p))}>
                {p}%
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function VoidDialog({ line, onClose, onConfirm }: { line: OrderItem | null; onClose: () => void; onConfirm: (reason: string, qty: number) => Promise<void> }) {
  // remounted per line via `key`, so initial state comes straight from the line
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState(line?.quantity ?? 1);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim(), qty);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!line}
      onClose={onClose}
      title={`Void ${line?.name ?? ""}`}
      size="sm"
      footer={
        <button className="btn-danger" disabled={busy || !reason.trim()} onClick={submit}>
          Void {qty} item{qty > 1 ? "s" : ""}
        </button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">This item was already sent to the kitchen. Voided items are kept for the cancellation report.</p>
      {line && line.quantity > 1 && (
        <Field label={`Quantity to void (of ${line.quantity})`} className="mb-3">
          <NumberStepper value={qty} onChange={setQty} min={1} max={line.quantity} label="quantity to void" />
        </Field>
      )}
      <Field label="Reason">
        <input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reason.trim() && submit()} />
      </Field>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {["Customer changed mind", "Wrong item punched", "Out of stock", "Quality issue"].map((r) => (
          <button key={r} className="btn-secondary btn-sm" onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function NoteDialog({ line, onClose, onSave }: { line: DraftLine | null; onClose: () => void; onSave: (n: string) => void }) {
  const [notes, setNotes] = useState("");
  useEffect(() => setNotes(line?.notes ?? ""), [line]);
  return (
    <Modal
      open={!!line}
      onClose={onClose}
      title={`Kitchen note - ${line?.name ?? ""}`}
      size="sm"
      footer={
        <button className="btn-primary" onClick={() => onSave(notes.trim())}>
          Save note
        </button>
      }
    >
      <input className="input" autoFocus placeholder="e.g. extra spicy, no onions" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {["Extra spicy", "Less spicy", "No onions", "Well done", "Pack separately"].map((n) => (
          <button key={n} className="btn-secondary btn-sm" onClick={() => setNotes((v) => (v ? `${v}, ${n}` : n))}>
            {n}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function DetailsDialog({
  open,
  order,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  order: Order | null;
  initial: { customerName: string; customerPhone: string; address: string; notes: string };
  onClose: () => void;
  onSave: (v: { customerName: string; customerPhone: string; address: string; notes: string; guests: number }) => Promise<void>;
}) {
  const [v, setV] = useState({ customerName: "", customerPhone: "", address: "", notes: "", guests: 1 });
  useEffect(() => {
    if (!open) return;
    setV(
      order
        ? { customerName: order.customer_name, customerPhone: order.customer_phone, address: order.delivery_address, notes: order.notes, guests: order.guests }
        : { ...initial, guests: 1 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order]);
  const isDelivery = order?.order_type === "delivery";
  return (
    <Modal open={open} onClose={onClose} title="Order details" size="sm" footer={<button className="btn-primary" onClick={() => onSave(v)}>Save</button>}>
      <div className="space-y-3">
        <Field label="Customer phone">
          <input className="input" value={v.customerPhone} onChange={(e) => setV({ ...v, customerPhone: e.target.value })} />
        </Field>
        <Field label="Customer name">
          <input className="input" value={v.customerName} onChange={(e) => setV({ ...v, customerName: e.target.value })} />
        </Field>
        {(isDelivery || !order) && (
          <Field label="Delivery address">
            <textarea className="input" rows={2} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
          </Field>
        )}
        {order?.order_type === "dine_in" && (
          <Field label="Guests">
            <NumberStepper value={v.guests} onChange={(g) => setV({ ...v, guests: g })} min={1} max={99} label="guests" />
          </Field>
        )}
        <Field label="Order notes (kitchen)">
          <textarea className="input" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
