"use client";

import { DatabaseBackup, Download, HardDriveDownload, History, Loader2, RotateCcw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { AsyncButton, Badge, Empty, ErrorBox, PageHeader, Spinner, useConfirm, useToast } from "@/components/ui";
import { api, saveBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";

interface BackupFile {
  name: string;
  size: number;
  created_at: string;
  kind: "automatic" | "manual" | "safety";
}

interface Status {
  interval_hours: number;
  keep: number;
  directory: string;
  last_automatic: BackupFile | null;
  files: BackupFile[];
}

interface RestoreResult {
  restored_from: string;
  counts: Record<string, number>;
  safety_backup: string;
}

const KIND_COLOR = { automatic: "blue", manual: "green", safety: "yellow" } as const;

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function BackupPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { logout } = useAuth();
  const { data, error, reload } = useApi<Status>("/backup/status");
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);

  const downloadNow = async () => {
    try {
      const { blob, filename } = await api.download("/backup/download");
      saveBlob(blob, filename);
      toast("Backup downloaded - keep it somewhere safe (USB drive, Google Drive, email)");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveOnServer = async () => {
    try {
      const r = await api.post<{ name: string }>("/backup/files");
      toast(`Saved ${r.name} in the backup folder`);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const downloadFile = async (name: string) => {
    try {
      const { blob } = await api.download(`/backup/files/${encodeURIComponent(name)}`);
      saveBlob(blob, name);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const afterRestore = (r: RestoreResult) => {
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    toast(`Restore complete: ${total.toLocaleString()} records. Please sign in again.`);
    setTimeout(logout, 2500);
  };

  const confirmRestore = (what: string) =>
    confirm({
      title: "Replace ALL data with this backup?",
      message: `Everything currently in the app (orders, menu, stock, users, settings) will be replaced by ${what}. A safety backup of the current data is saved first, so this can be undone from the list below. Everyone will need to sign in again.`,
      confirmText: "Yes, restore",
      danger: true,
    });

  const restoreFromFile = async (file: File) => {
    if (!(await confirmRestore(`the backup file "${file.name}"`))) return;
    setRestoring(true);
    try {
      const form = new FormData();
      form.append("file", file);
      afterRestore(await api.upload<RestoreResult>("/backup/restore", form));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRestoring(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const restoreServerFile = async (f: BackupFile) => {
    if (!(await confirmRestore(`the ${f.kind} backup from ${dateTime(f.created_at)}`))) return;
    setRestoring(true);
    try {
      afterRestore(await api.post<RestoreResult>(`/backup/files/${encodeURIComponent(f.name)}/restore`));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title="Backup & Restore" subtitle="Protect your data against PC damage, theft or mistakes" />
      <ErrorBox message={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <HardDriveDownload size={18} className="text-brand-600" /> Download a backup
          </div>
          <p className="mb-4 text-sm text-slate-500">
            One file with all data: orders, menu, tables, customers, inventory, expenses, users and settings. Save it to a USB drive or cloud storage regularly.
          </p>
          <div className="flex flex-wrap gap-2">
            <AsyncButton onClick={downloadNow}>
              <Download size={16} /> Download backup now
            </AsyncButton>
            <AsyncButton className="btn-secondary" onClick={saveOnServer}>
              <DatabaseBackup size={16} /> Save copy on this PC
            </AsyncButton>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Upload size={18} className="text-red-600" /> Import (restore) a backup
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Load a <code>.rmsbak</code> file to bring back data, e.g. on a new PC after reinstalling. This <b>replaces</b> all current data.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".rmsbak,application/octet-stream,application/gzip"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && restoreFromFile(e.target.files[0])}
          />
          <button className="btn-danger" disabled={restoring} onClick={() => fileRef.current?.click()}>
            {restoring ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Choose backup file…
          </button>
        </div>
      </div>

      <div className="card mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
          <div className="flex items-center gap-2 font-semibold">
            <History size={18} className="text-sky-600" /> Backups stored on this PC
          </div>
          {data && (
            <div className="text-xs text-slate-500">
              {data.interval_hours > 0
                ? `Automatic backup every ${data.interval_hours} h, newest ${data.keep} kept`
                : "Automatic backups are switched off"}
              {data.last_automatic && ` · last: ${dateTime(data.last_automatic.created_at)}`}
              <div className="truncate">Folder: {data.directory}</div>
            </div>
          )}
        </div>
        {!data ? (
          <Spinner />
        ) : data.files.length === 0 ? (
          <Empty message="No backups saved on this PC yet. The first automatic backup is made shortly after the app starts." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Type</th>
                  <th>File</th>
                  <th className="text-right">Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.files.map((f) => (
                  <tr key={f.name}>
                    <td className="whitespace-nowrap">{dateTime(f.created_at)}</td>
                    <td>
                      <Badge color={KIND_COLOR[f.kind]}>{f.kind === "safety" ? "BEFORE RESTORE" : f.kind.toUpperCase()}</Badge>
                    </td>
                    <td className="text-xs text-slate-500">{f.name}</td>
                    <td className="text-right">{size(f.size)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-ghost btn-sm" onClick={() => downloadFile(f.name)} title="Download">
                        <Download size={14} />
                      </button>
                      <button className="btn-ghost btn-sm text-red-600" disabled={restoring} onClick={() => restoreServerFile(f)} title="Restore this backup">
                        <RotateCcw size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Tip: backups on this PC do not help if the PC itself is lost or damaged - also download one regularly and keep it elsewhere.
      </p>
    </div>
  );
}
