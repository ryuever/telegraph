import React from 'react';
import { cn } from '@/packages/ui/lib/utils';

interface SparklineProps {
  values: number[];
  max?: number;
  className?: string;
  fill?: boolean;
  height?: number;
  showGrid?: boolean;
}

export function Sparkline({
  values,
  max,
  className,
  fill = true,
  height = 48,
  showGrid = true,
}: SparklineProps) {
  const width = 200;
  const padding = 1.5;

  const safeValues = values.length > 0 ? values : [0];
  const computedMax = Math.max(1, max ?? Math.max(1, ...safeValues));
  const span = Math.max(safeValues.length - 1, 1);

  const points = safeValues.map((v, i) => {
    const x = (i / span) * (width - padding * 2) + padding;
    const ratio = Math.min(Math.max(v, 0), computedMax) / computedMax;
    const y = height - padding - ratio * (height - padding * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const linePath = points.join(' ');
  const areaPath =
    safeValues.length > 1
      ? `M ${points.join(' L ')} L ${String(width - padding)},${
          String(height - padding)
        } L ${String(padding)},${String(height - padding)} Z`
      : '';

  const gridLines = [0.25, 0.5, 0.75];

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
    >
      {showGrid &&
        gridLines.map((p) => (
          <line
            key={p}
            x1={0}
            x2={width}
            y1={height * p}
            y2={height * p}
            stroke="currentColor"
            strokeOpacity={0.07}
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {fill && safeValues.length > 1 && (
        <path d={areaPath} fill="currentColor" fillOpacity={0.15} />
      )}
      <polyline
        points={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function cpuColorClass(value: number) {
  if (value >= 70) return 'text-rose-400';
  if (value >= 30) return 'text-amber-400';
  return 'text-emerald-400';
}
