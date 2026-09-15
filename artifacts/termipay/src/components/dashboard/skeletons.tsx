export function SkeletonBar({ className = "", isDark }: { className?: string; isDark: boolean }) {
  return <div className={`animate-pulse rounded ${isDark ? "bg-slate-800" : "bg-slate-200"} ${className}`} />;
}

export function SkeletonRow({ isDark }: { isDark: boolean }) {
  return <div className="flex items-center gap-3"><SkeletonBar isDark={isDark} className="h-9 w-9 rounded-full shrink-0" /><div className="flex-1 space-y-1.5"><SkeletonBar isDark={isDark} className="h-2.5 w-16" /><SkeletonBar isDark={isDark} className="h-3.5 w-32" /></div></div>;
}
