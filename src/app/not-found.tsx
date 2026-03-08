import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#07070D' }}>
      <div className="max-w-md w-full text-center">
        <p className="text-7xl font-bold text-zinc-700 mb-4">404</p>

        <h1 className="text-2xl font-semibold text-white mb-2">
          Page not found
        </h1>
        <p className="text-sm text-zinc-400 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="px-5 py-2.5 text-sm font-medium rounded-xl bg-white text-black hover:bg-zinc-200 transition-colors"
          >
            Back to Home
          </Link>
          <Link
            href="/dashboard"
            className="px-5 py-2.5 text-sm font-medium rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
