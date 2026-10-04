"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <h2 className="text-lg font-semibold">Something went wrong on this screen</h2>
      <p className="mt-2 break-words text-sm text-slate-500">{error.message}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn-primary" onClick={reset}>
          Try again
        </button>
        <button className="btn-secondary" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </div>
  );
}
