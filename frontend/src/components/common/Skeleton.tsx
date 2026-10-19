const ROW_WIDTHS = [72, 56, 64, 48, 60, 52];

/** Pulsing placeholder rows shown while a list loads. */
export function SkeletonRows({ rows = 4, label = 'Loading', className = '' }: { rows?: number; label?: string; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-3 animate-pulse bg-gray-800/80"
          style={{ width: `${ROW_WIDTHS[index % ROW_WIDTHS.length]}%` }}
        />
      ))}
    </div>
  );
}
