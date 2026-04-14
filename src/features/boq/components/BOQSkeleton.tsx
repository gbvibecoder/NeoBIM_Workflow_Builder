"use client";

export function BOQSkeleton() {
  const shimmer = "animate-pulse bg-gray-200 rounded";
  const shimmerLight = "animate-pulse bg-gray-100 rounded";

  return (
    <div className="h-full overflow-y-auto" style={{ background: "#FAFAF8" }}>
      <div className="max-w-[1360px] mx-auto py-8 px-6 flex flex-col gap-8">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse" />
            <div>
              <div className={`h-5 w-48 ${shimmer}`} />
              <div className={`h-3 w-32 ${shimmerLight} mt-2`} />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-20 bg-gray-200 rounded-full animate-pulse" />
            <div className="h-8 w-28 bg-teal-100 rounded-xl animate-pulse" />
          </div>
        </div>

        {/* Hero card skeleton */}
        <div className="rounded-2xl p-6 bg-white" style={{ border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}>
          <div className={`h-3 w-36 ${shimmerLight} mb-3`} />
          <div className={`h-12 w-48 ${shimmer} mb-4`} />
          <div className="h-2 w-full bg-gray-100 rounded-full animate-pulse" />
        </div>

        {/* Three metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl p-5 bg-white" style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
              <div className={`h-3 w-20 ${shimmerLight} mb-3`} />
              <div className={`h-8 w-32 ${shimmer}`} />
            </div>
          ))}
        </div>

        {/* Charts area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl p-6 bg-white h-56" style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
            <div className={`h-4 w-32 ${shimmerLight} mb-6`} />
            <div className="flex items-center gap-6">
              <div className="w-36 h-36 rounded-full border-[10px] border-gray-100 animate-pulse" />
              <div className="flex flex-col gap-3 flex-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-gray-200" />
                    <div className={`h-3 flex-1 ${shimmerLight}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-2xl p-6 bg-white h-56" style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
            <div className={`h-4 w-32 ${shimmerLight} mb-6`} />
            <div className="flex flex-col gap-4">
              {[80, 60, 40, 25, 15].map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-gray-100 animate-pulse" />
                  <div className={`h-2 rounded-full ${shimmerLight}`} style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Table skeleton */}
        <div className="rounded-2xl bg-white overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
          <div className="p-4 flex gap-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-8 w-20 bg-gray-100 rounded-full animate-pulse" />
            ))}
          </div>
          {[1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.02)" }}>
              <div className={`h-3 w-20 ${shimmerLight}`} />
              <div className={`h-3 flex-1 ${shimmerLight}`} />
              <div className={`h-3 w-12 ${shimmerLight}`} />
              <div className={`h-3 w-20 ${shimmer}`} />
              <div className="h-5 w-14 bg-gray-100 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
