"use client";

import { BarChart3, Boxes, Wallet } from "lucide-react";
import Link from "next/link";
import { ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import type { ReportMeta } from "@/lib/types";

const ICONS: Record<string, React.ElementType> = { Sales: BarChart3, Inventory: Boxes, Finance: Wallet };

export default function ReportsPage() {
  const { data, error } = useApi<ReportMeta[]>("/reports");
  const groups = Array.from(new Set((data ?? []).map((r) => r.group)));
  return (
    <div>
      <PageHeader title="Reports" subtitle={`${data?.length ?? ""} business reports - pick one to run for any date range`} />
      <ErrorBox message={error} />
      {!data && <Spinner />}
      {groups.map((g) => {
        const Icon = ICONS[g] ?? BarChart3;
        return (
          <div key={g} className="mb-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500"><Icon size={16} /> {g}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data!.filter((r) => r.group === g).map((r) => (
                <Link key={r.key} href={`/reports/${r.key}`} className="card p-4 transition hover:border-brand-400 hover:shadow-md">
                  <div className="font-semibold text-slate-900">{r.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{r.description}</div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
