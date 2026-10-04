"use client";

import { Save } from "lucide-react";
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
      <div className="card mt-6 grid gap-4 p-5 sm:grid-cols-3">
        <h3 className="font-semibold sm:col-span-3">Change my password</h3>
        <Field label="Current password"><input className="input" type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
        <Field label="New password"><input className="input" type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
        <div className="flex items-end"><button className="btn-secondary" disabled={!pw.current_password || pw.new_password.length < 6} onClick={changePw}>Change password</button></div>
      </div>
    </div>
  );
}
