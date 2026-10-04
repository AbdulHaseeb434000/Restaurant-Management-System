"use client";

import { ClipboardList, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePageTitle } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  usePageTitle("Sign in");

  useEffect(() => {
    if (!loading && user) router.replace(homeFor(user.role));
  }, [loading, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(username.trim(), password);
      router.replace(homeFor(u.role));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 rounded-xl bg-brand-600 p-3 text-white">
            <ClipboardList size={28} />
          </div>
          <h1 className="text-xl font-bold">Restaurant Management</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>
        {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="username">Username</label>
            <input id="username" className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <div className="relative">
              <input id="password" type={showPw ? "text" : "password"} className="input pr-10" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />} Sign in
          </button>
        </div>
        <div className="mt-6 border-t border-slate-100 pt-4">
          <p className="mb-2 text-center text-xs text-slate-400">Demo accounts - click to fill</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {["admin", "manager", "cashier", "waiter", "kitchen", "store"].map((u) => (
              <button
                key={u}
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setUsername(u);
                  setPassword(`${u}123`);
                }}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
