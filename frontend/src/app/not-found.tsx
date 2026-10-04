import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-6xl font-bold text-brand-600">404</div>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-slate-500">The page you are looking for does not exist or was moved.</p>
      <Link href="/" className="btn-primary mt-2">
        Back to the app
      </Link>
    </div>
  );
}
