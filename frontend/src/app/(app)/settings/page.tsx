"use client";

import clsx from "clsx";
import { BookOpenCheck, PackageMinus, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AsyncButton, Field, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AppSettings } from "@/lib/types";

export default function SettingsPage() {
  const toast = useToast();
  const { settings, refreshSettings } = useAuth();
  const [form, setForm] = useState<AppSettings | null>(null);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  if (!form) return <Spinner />;

  const save = async () => {
    try {
      await api.put("/settings", {
        ...form,
        tax_rate: Number(form.tax_rate) || 0,
        service_charge_rate: Number(form.service_charge_rate) || 0,
        default_delivery_fee: Number(form.default_delivery_fee) || 0,
      });
      await refreshSettings();
      toast("Settings saved");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const changePw = async () => {
    try {
      await api.post("/auth/change-password", pw);
      setPw({ current_password: "", new_password: "" });
      toast("Password changed");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const set = (k: keyof AppSettings, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Restaurant profile, taxes and charges" actions={<AsyncButton onClick={save}><Save size={16} /> Save settings</AsyncButton>} />
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Restaurant name" className="sm:col-span-2"><input className="input" value={form.restaurant_name} onChange={(e) => set("restaurant_name", e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Currency symbol"><input className="input" value={form.currency} onChange={(e) => set("currency", e.target.value)} /></Field>
        <Field label="Tax rate % (applied after discount + service)"><input className="input" type="number" min={0} step="0.01" value={form.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} /></Field>
        <Field label="Service charge % (dine-in only)"><input className="input" type="number" min={0} step="0.01" value={form.service_charge_rate} onChange={(e) => set("service_charge_rate", e.target.value)} /></Field>
        <Field label="Default delivery fee"><input className="input" type="number" min={0} step="0.01" value={form.default_delivery_fee} onChange={(e) => set("default_delivery_fee", e.target.value)} /></Field>
        <Field label="Receipt footer" className="sm:col-span-2"><input className="input" value={form.receipt_footer} onChange={(e) => set("receipt_footer", e.target.value)} /></Field>
      </div>

      <div className="card mt-6 p-5">
        <h3 className="font-semibold">Inventory method</h3>
        <p className="mb-4 text-sm text-slate-500">
          How ingredient usage and food cost are recorded. You can switch at any time; the change applies to orders completed from then on. Save settings to apply.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              {
                key: "issue",
                icon: PackageMinus,
                title: "Store → Kitchen issue",
                text: "The storekeeper issues ingredients to the kitchen. Food cost = value issued. Sales do not change stock. Simple, no recipes needed.",
              },
              {
                key: "recipe",
                icon: BookOpenCheck,
                title: "Recipe mapping",
                text: "Each dish has a recipe. Completing an order automatically deducts its ingredients. Food cost = recipe cost of dishes sold.",
              },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setForm({ ...form, inventory_mode: o.key })}
              className={clsx(
                "rounded-xl border-2 p-4 text-left transition",
                form.inventory_mode === o.key ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <div className="flex items-center gap-2 font-semibold">
                <o.icon size={18} className={form.inventory_mode === o.key ? "text-brand-600" : "text-slate-400"} />
                {o.title}
                {form.inventory_mode === o.key && <span className="ml-auto rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">Selected</span>}
              </div>
              <p className="mt-1 text-sm text-slate-600">{o.text}</p>
            </button>
          ))}
        </div>
        {form.inventory_mode === "recipe" && (
          <div className="mt-4 rounded-lg bg-slate-50 p-4">
            <div className="label">Deduct recipe ingredients from</div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={form.recipe_stock_location === "kitchen"} onChange={() => setForm({ ...form, recipe_stock_location: "kitchen" })} />
                <span>
                  <b>Kitchen stock</b> - keep issuing from store to kitchen; sales consume kitchen stock. Best for spotting kitchen waste (see Ingredient Usage Variance report).
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={form.recipe_stock_location === "store"} onChange={() => setForm({ ...form, recipe_stock_location: "store" })} />
                <span>
                  <b>Store stock</b> - no separate kitchen store; sales consume store stock directly. Issues to kitchen become optional.
                </span>
              </label>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Set up recipes under <Link href="/menu" className="text-brand-700 underline">Menu Management</Link> (Recipe button on each item). Dishes without a recipe are sold without deducting stock. Stock may go below zero if purchases or issues were not recorded - sales are never blocked.
            </p>
          </div>
        )}
      </div>
      <div className="card mt-6 grid gap-4 p-5 sm:grid-cols-3">
        <h3 className="font-semibold sm:col-span-3">Change my password</h3>
        <Field label="Current password"><input className="input" type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
        <Field label="New password"><input className="input" type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
        <div className="flex items-end"><button className="btn-secondary" disabled={!pw.current_password || pw.new_password.length < 6} onClick={changePw}>Change password</button></div>
      </div>
    </div>
  );
}
