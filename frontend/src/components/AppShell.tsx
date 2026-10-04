"use client";

import clsx from "clsx";
import {
  BarChart3,
  Bike,
  BookOpen,
  CalendarCheck,
  Boxes,
  ChefHat,
  ClipboardList,
  History,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu as MenuIcon,
  Package,
  PackageMinus,
  PackagePlus,
  Receipt,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCog,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { homeFor, useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { Spinner } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  roles: Role[];
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["manager", "cashier"] },
      { href: "/pos", label: "POS", icon: ShoppingCart, roles: ["manager", "cashier", "waiter"] },
      { href: "/tables", label: "Tables", icon: LayoutGrid, roles: ["manager", "cashier", "waiter"] },
      { href: "/orders", label: "Orders", icon: Receipt, roles: ["manager", "cashier", "waiter"] },
      { href: "/kitchen", label: "Kitchen Display", icon: ChefHat, roles: ["manager", "kitchen", "cashier", "waiter"] },
      { href: "/deliveries", label: "Deliveries", icon: Bike, roles: ["manager", "cashier"] },
      { href: "/customers", label: "Customers", icon: Users, roles: ["manager", "cashier", "waiter"] },
    ],
  },
  {
    section: "Menu",
    items: [{ href: "/menu", label: "Menu Management", icon: BookOpen, roles: ["manager"] }],
  },
  {
    section: "Inventory",
    items: [
      { href: "/inventory/stock", label: "Stock Overview", icon: Boxes, roles: ["manager", "storekeeper", "kitchen"] },
      { href: "/inventory/items", label: "Items / Ingredients", icon: Package, roles: ["manager", "storekeeper"] },
      { href: "/inventory/purchases", label: "Purchases (GRN)", icon: PackagePlus, roles: ["manager", "storekeeper"] },
      { href: "/inventory/issues", label: "Store → Kitchen Issue", icon: PackageMinus, roles: ["manager", "storekeeper"] },
      { href: "/inventory/adjustments", label: "Adjustments / Wastage", icon: SlidersHorizontal, roles: ["manager", "storekeeper", "kitchen"] },
      { href: "/inventory/suppliers", label: "Suppliers", icon: Truck, roles: ["manager", "storekeeper"] },
      { href: "/inventory/ledger", label: "Stock Ledger", icon: History, roles: ["manager", "storekeeper", "kitchen"] },
    ],
  },
  {
    section: "Business",
    items: [
      { href: "/reports/day-end", label: "Day End (Z Report)", icon: CalendarCheck, roles: ["manager", "cashier"] },
      { href: "/expenses", label: "Expenses", icon: Wallet, roles: ["manager"] },
      { href: "/reports", label: "Reports", icon: BarChart3, roles: ["manager"] },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/users", label: "Users", icon: UserCog, roles: [] },
      { href: "/settings", label: "Settings", icon: Settings, roles: ["manager"] },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function canAccess(pathname: string, role: Role): boolean {
  if (role === "admin") return true;
  const all = NAV.flatMap((s) => s.items);
  const match = all
    .filter((i) => isActive(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return !match || match.roles.includes(role);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, settings, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    setOpen(false);
    document.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname, user]);

  if (loading || !user) return <Spinner className="h-screen" />;

  const allowed = canAccess(pathname, user.role);
  const activeHref = NAV.flatMap((s) => s.items)
    .filter((i) => isActive(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const sections = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => user.role === "admin" || i.roles.includes(user.role)),
  })).filter((s) => s.items.length);

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside
        className={clsx(
          "no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 text-slate-300 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
          <div className="rounded-lg bg-brand-600 p-1.5 text-white">
            <ClipboardList size={18} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-white">{settings?.restaurant_name ?? "Restaurant"}</div>
            <div className="text-xs text-slate-400">Management System</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {sections.map((s) => (
            <div key={s.section} className="mb-4">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{s.section}</div>
              {s.items.map((item) => {
                const Icon = item.icon;
                const active = activeHref === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-active={active}
                    className={clsx(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                      active ? "bg-brand-600 text-white" : "hover:bg-slate-800 hover:text-white",
                    )}
                  >
                    <Icon size={17} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <div className="mb-2 px-2">
            <div className="truncate text-sm font-medium text-white">{user.full_name}</div>
            <div className="text-xs capitalize text-slate-400">{user.role}</div>
          </div>
          <button className="btn w-full justify-start text-slate-300 hover:bg-slate-800 hover:text-white" onClick={logout}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
          <button className="btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon size={20} />
          </button>
          <span className="font-semibold">{settings?.restaurant_name}</span>
        </header>
        <main className="flex-1 p-4 lg:p-6">
          {allowed ? (
            children
          ) : (
            <div className="card mx-auto mt-10 max-w-md p-8 text-center">
              <h2 className="text-lg font-semibold">Access denied</h2>
              <p className="mt-2 text-sm text-slate-500">Your role ({user.role}) cannot open this page.</p>
              <Link href={homeFor(user.role)} className="btn-primary mt-4">
                Go to my home page
              </Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
