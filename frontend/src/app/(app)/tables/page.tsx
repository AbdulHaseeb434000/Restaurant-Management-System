"use client";

import clsx from "clsx";
import { Clock, Pencil, Plus, Settings2, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AsyncButton, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, StatusBadge, Toggle, useConfirm, useToast } from "@/components/ui";
import ExportButton from "@/components/ExportButton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { minutesSince, money } from "@/lib/format";
import { tablesSheets } from "@/lib/exports";
import { useApi } from "@/lib/hooks";
import type { Area, DiningTable } from "@/lib/types";

const STATUS_STYLE: Record<DiningTable["status"], string> = {
  available: "border-emerald-300 bg-emerald-50 hover:bg-emerald-100",
  occupied: "border-brand-400 bg-brand-50 hover:bg-brand-100",
  reserved: "border-violet-300 bg-violet-50 hover:bg-violet-100",
  cleaning: "border-amber-300 bg-amber-50 hover:bg-amber-100",
};

export default function TablesPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { hasRole } = useAuth();
  const isManager = hasRole("manager");
  const { data: tables, error, reload } = useApi<DiningTable[]>("/tables", undefined, { refreshMs: 15000 });
  const { data: areas, reload: reloadAreas } = useApi<Area[]>("/areas");
  const [selected, setSelected] = useState<DiningTable | null>(null);
  const [manage, setManage] = useState(false);
  const [editTable, setEditTable] = useState<Partial<DiningTable> | null>(null);
  const [editArea, setEditArea] = useState<Partial<Area> | null>(null);

  const grouped = useMemo(() => {
    const g = new Map<string, DiningTable[]>();
    for (const t of tables ?? []) {
      const k = t.area_name ?? "Unassigned";
      g.set(k, [...(g.get(k) ?? []), t]);
    }
    return Array.from(g.entries());
  }, [tables]);

  const counts = useMemo(() => {
    const c = { available: 0, occupied: 0, reserved: 0, cleaning: 0 };
    for (const t of tables ?? []) c[t.status] += 1;
    return c;
  }, [tables]);

  const onTableClick = (t: DiningTable) => {
    if (t.open_order_id) router.push(`/pos?order=${t.open_order_id}`);
    else setSelected(t);
  };

  const setStatus = async (t: DiningTable, status: string) => {
    try {
      await api.patch(`/tables/${t.id}/status`, { status });
      toast(`${t.name} marked ${status}`);
      setSelected(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveTable = async () => {
    if (!editTable) return;
    try {
      const body = { name: editTable.name, area_id: editTable.area_id || null, capacity: Number(editTable.capacity) || 1, is_active: editTable.is_active ?? true };
      if (editTable.id) await api.put(`/tables/${editTable.id}`, body);
      else await api.post("/tables", body);
      toast("Table saved");
      setEditTable(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveArea = async () => {
    if (!editArea) return;
    try {
      if (editArea.id) await api.put(`/areas/${editArea.id}`, { name: editArea.name });
      else await api.post("/areas", { name: editArea.name });
      toast("Area saved");
      setEditArea(null);
      reloadAreas();
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (path: string, label: string, after: () => void) => {
    if (!(await confirm({ title: `Delete ${label}?`, message: label.startsWith("table") ? "Tables with order history are deactivated instead." : undefined, confirmText: "Delete", danger: true }))) return;
    try {
      await api.del(path);
      toast(`${label} deleted`);
      after();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Tables"
        subtitle={`${counts.available} available · ${counts.occupied} occupied · ${counts.reserved} reserved · ${counts.cleaning} cleaning`}
        actions={
          <>
            <ExportButton filename="Tables" sheets={() => tablesSheets(tables ?? [])} disabled={!tables?.length} />
            {isManager && (
            <button className={manage ? "btn-primary" : "btn-secondary"} onClick={() => setManage(!manage)}>
              <Settings2 size={16} /> {manage ? "Done" : "Manage tables"}
            </button>
          )}
          </>
        }
      />
      <ErrorBox message={error} />
      {!tables && <Spinner />}

      {manage ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-200 p-3">
              <h3 className="font-semibold">Tables</h3>
              <button className="btn-primary btn-sm" onClick={() => setEditTable({ name: "", capacity: 4, area_id: areas?.[0]?.id ?? null, is_active: true })}>
                <Plus size={14} /> Add table
              </button>
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Area</th>
                  <th>Seats</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(tables ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium">{t.name}</td>
                    <td>{t.area_name ?? "-"}</td>
                    <td>{t.capacity}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="text-right">
                      <button className="btn-ghost btn-sm" onClick={() => setEditTable(t)} aria-label="Edit"><Pencil size={14} /></button>
                      <button className="btn-ghost btn-sm text-red-600" onClick={() => remove(`/tables/${t.id}`, `table ${t.name}`, reload)} aria-label="Delete"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card self-start">
            <div className="flex items-center justify-between border-b border-slate-200 p-3">
              <h3 className="font-semibold">Areas / Sections</h3>
              <button className="btn-primary btn-sm" onClick={() => setEditArea({ name: "" })}><Plus size={14} /> Add</button>
            </div>
            <ul className="divide-y divide-slate-100">
              {(areas ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  {a.name}
                  <span>
                    <button className="btn-ghost btn-sm" onClick={() => setEditArea(a)} aria-label="Edit"><Pencil size={14} /></button>
                    <button className="btn-ghost btn-sm text-red-600" onClick={() => remove(`/areas/${a.id}`, `area ${a.name}`, reloadAreas)} aria-label="Delete"><Trash2 size={14} /></button>
                  </span>
                </li>
              ))}
              {areas?.length === 0 && <Empty message="No areas" />}
            </ul>
          </div>
        </div>
      ) : (
        grouped.map(([area, list]) => (
          <div key={area} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{area}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {list.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTableClick(t)}
                  className={clsx("flex h-28 flex-col justify-between rounded-xl border-2 p-3 text-left transition", STATUS_STYLE[t.status])}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold">{t.name}</span>
                    <span className="flex items-center gap-0.5 text-xs text-slate-500"><Users size={12} />{t.capacity}</span>
                  </div>
                  {t.open_order_id ? (
                    <div className="text-xs">
                      <div className="font-semibold">{money(t.open_order_total)}</div>
                      <div className="flex items-center gap-1 text-slate-500"><Clock size={11} />{minutesSince(t.open_since)} min</div>
                    </div>
                  ) : (
                    <span className="text-xs font-medium capitalize text-slate-600">{t.status}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      {tables?.length === 0 && !manage && <Empty message="No tables configured yet." />}

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Table ${selected?.name ?? ""}`} size="sm">
        {selected && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              {selected.capacity} seats · {selected.area_name ?? "No area"} · currently <b>{selected.status}</b>
            </p>
            <button className="btn-primary w-full py-3" onClick={() => router.push(`/pos?table=${selected.id}`)}>
              <Plus size={16} /> Start new order
            </button>
            <div className="grid grid-cols-3 gap-2">
              {(["available", "reserved", "cleaning"] as const).map((s) => (
                <button key={s} className="btn-secondary btn-sm capitalize" disabled={selected.status === s} onClick={() => setStatus(selected, s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editTable}
        onClose={() => setEditTable(null)}
        title={editTable?.id ? "Edit table" : "Add table"}
        size="sm"
        footer={<AsyncButton onClick={saveTable}>Save</AsyncButton>}
      >
        {editTable && (
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={editTable.name ?? ""} onChange={(e) => setEditTable({ ...editTable, name: e.target.value })} /></Field>
            <Field label="Area">
              <select className="input" value={editTable.area_id ?? ""} onChange={(e) => setEditTable({ ...editTable, area_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">- none -</option>
                {(areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Seats"><input className="input" type="number" min={1} value={editTable.capacity ?? 4} onChange={(e) => setEditTable({ ...editTable, capacity: Number(e.target.value) })} /></Field>
            <Toggle label="Active" checked={editTable.is_active ?? true} onChange={(v) => setEditTable({ ...editTable, is_active: v })} />
          </div>
        )}
      </Modal>
      <Modal open={!!editArea} onClose={() => setEditArea(null)} title={editArea?.id ? "Edit area" : "Add area"} size="sm" footer={<AsyncButton onClick={saveArea}>Save</AsyncButton>}>
        <Field label="Name"><input className="input" autoFocus value={editArea?.name ?? ""} onChange={(e) => setEditArea({ ...editArea, name: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}
