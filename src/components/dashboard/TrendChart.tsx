import type { DayBar } from "@/lib/dashboard/overview";

/**
 * TREND CHART (2026-11-12): the reference's analytics panel, drawn from rows that exist.
 *
 * The series is handed in already counted (see weekActivity), so this component cannot invent a
 * day: an empty day is a zero-height mark, not a gap. A failed read is a sentence, never a flat
 * line at zero, because "quiet" and "unreadable" are different facts.
 *
 * Colours live in globals.css (.trend-line/.trend-bar) so the chart carries no literal hex and
 * follows the theme.
 */
interface TrendChartProps {
  title: string;
  subtitle: string;
  series: DayBar[];
  variant: "line" | "bars";
  unreadable?: boolean;
  sourceNote?: string;
  /** What one mark counts, named in the accessible description. */
  unit?: string;
}

export function TrendChart({
  title,
  subtitle,
  series,
  variant,
  unreadable = false,
  sourceNote,
  unit = "events",
}: TrendChartProps) {
  const max = Math.max(1, ...series.map((day) => day.count));
  const total = series.reduce((sum, day) => sum + day.count, 0);
  const width = 100;
  const height = 36;
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const points = series
    .map((day, index) => {
      const x = series.length > 1 ? index * step : width / 2;
      const y = height - (day.count / max) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const label = `Recorded ${unit} over the last ${series.length} days: ${series
    .map((day) => `${day.label} ${day.count}`)
    .join(", ")}`;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="dash-panel-title">{title}</h2>
          <p className="dash-panel-sub mt-1">{subtitle}</p>
        </div>
        <p className="dash-chip">
          {unreadable ? "Could not read" : `${total} ${unit} in ${series.length} days`}
        </p>
      </div>

      {unreadable ? (
        <p className="mt-3 text-sm text-ink-soft">
          We couldn&apos;t read this activity just now. That is not the same as a quiet week, so the
          chart is left out rather than drawn flat at zero.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="mt-4 h-28 w-full"
            role="img"
            aria-label={label}
          >
            <title>{label}</title>
            {variant === "line" ? (
              <>
                <polyline className="trend-line" points={points} fill="none" vectorEffect="non-scaling-stroke" />
                {series.map((day, index) => {
                  const x = series.length > 1 ? index * step : width / 2;
                  const y = height - (day.count / max) * height;
                  return day.count === 0 ? null : (
                    <circle key={day.key} className="trend-dot" cx={x} cy={y} r={day.isToday ? 1.4 : 0.9} />
                  );
                })}
              </>
            ) : (
              series.map((day, index) => {
                const slot = width / series.length;
                const barHeight = (day.count / max) * height;
                return (
                  <rect
                    key={day.key}
                    className="trend-bar"
                    data-on={day.count > 0}
                    x={index * slot + slot * 0.2}
                    y={height - Math.max(barHeight, 0.5)}
                    width={slot * 0.6}
                    height={Math.max(barHeight, 0.5)}
                    rx={0.6}
                  />
                );
              })
            )}
          </svg>
          <div className="mt-1 flex justify-between gap-1 text-[11px] text-ink-soft">
            {series.map((day, index) => (
              <span key={day.key} className="min-w-0 flex-1 text-center">
                {index === 0 || index === series.length - 1 || day.isToday ? day.label : "\u00a0"}
              </span>
            ))}
          </div>
          {sourceNote && <p className="mt-2 text-xs text-ink-soft">{sourceNote}</p>}
        </>
      )}
    </div>
  );
}
