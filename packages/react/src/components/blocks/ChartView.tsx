import { Fragment, useEffect, useRef, useState, type PointerEvent } from "react";
import type { ChartBlock } from "@klymbak/protocol";
import type { I18n } from "@klymbak/client";
import { useI18n } from "../../context";

const HEIGHT = 220;

const valueOf = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
};

function formatX(i18n: I18n, value: unknown, format: ChartBlock["x"]["format"]) {
  if (format === "date" && typeof value === "string") {
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (!Number.isNaN(date.getTime())) return i18n.formatValue(date, "date");
  }
  return i18n.formatValue(value, format);
}

const seriesColor = (index: number) => `var(--kl-series-${(index % 4) + 1})`;

export function ChartView({ block }: { block: ChartBlock }) {
  const i18n = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    setWidth((current) => el.clientWidth || current);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { series, data } = block;
  const n = data.length;

  // Round tick steps (1, 2, 2.5, 5 × 10^k) so every label is a value the axis reaches.
  const values = data.flatMap((row) => series.map((s) => valueOf(row, s.key)));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const rough = (max - min || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);

  const primary = series[0];
  const tickLabel = (value: number) => i18n.compactNumber(value, primary?.format, primary?.currency);

  const longest = Math.max(...ticks.map((t) => tickLabel(t).length));
  const margin = { top: 12, right: 14, bottom: 28, left: Math.max(36, longest * 7 + 14) };
  const inner = { width: Math.max(80, width - margin.left - margin.right), height: HEIGHT - margin.top - margin.bottom };

  const y = (value: number) => margin.top + inner.height - ((value - bottom) / (top - bottom)) * inner.height;
  const band = inner.width / Math.max(1, n);
  const xCenter = (index: number) => {
    if (block.kind === "bar") return margin.left + band * (index + 0.5);
    return margin.left + (n <= 1 ? inner.width / 2 : (index * inner.width) / (n - 1));
  };

  const bars =
    block.kind !== "bar"
      ? []
      : data.flatMap((row, i) => {
          const groupWidth = band * 0.72;
          const barWidth = Math.max(2, groupWidth / series.length - (series.length > 1 ? 2 : 0));
          return series.map((s, j) => {
            const value = valueOf(row, s.key);
            const x = xCenter(i) - groupWidth / 2 + j * (groupWidth / series.length);
            const height = Math.abs(y(value) - y(0));
            return { key: `${i}-${s.key}`, x, y: y(Math.max(0, value)), width: barWidth, height: Math.max(height, value ? 1 : 0), color: j };
          });
        });

  const lines =
    block.kind === "bar"
      ? []
      : series.map((s, j) => {
          const points = data.map((row, i) => [xCenter(i), y(valueOf(row, s.key))] as const);
          const path = points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
          const area = points.length
            ? `${path}L${points[points.length - 1]![0].toFixed(1)},${y(0).toFixed(1)}L${points[0]![0].toFixed(1)},${y(0).toFixed(1)}Z`
            : "";
          return { key: s.key, path, area, last: points[points.length - 1], color: j };
        });

  const xLabels = (() => {
    if (!n) return [];
    const room = Math.max(1, Math.floor(inner.width / 72));
    const every = Math.ceil(n / room);
    return data
      .map((row, i) => ({ i, text: formatX(i18n, row[block.x.key], block.x.format) }))
      .filter(({ i }) => i % every === 0 || i === n - 1)
      .filter((label, k, all) => k === all.length - 1 || all[all.length - 1]!.i - label.i >= every * 0.6);
  })();

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    if (!n) return;
    let nearest = 0;
    let distance = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xCenter(i) - px);
      if (d < distance) {
        distance = d;
        nearest = i;
      }
    }
    setHover(nearest);
  }

  const hovered = hover === null ? undefined : data[hover];
  const tooltip =
    hover === null || !hovered
      ? null
      : {
          x: xCenter(hover),
          left: xCenter(hover) > width * 0.6,
          title: formatX(i18n, hovered[block.x.key], block.x.format),
          items: series.map((s, j) => ({ label: s.label, value: i18n.formatValue(hovered[s.key], s.format, s.currency), color: j })),
        };

  return (
    <figure className="kl-chart">
      {block.title && (
        <figcaption className="kl-chart__title">
          {block.title}
          {series.length > 1 && (
            <span className="kl-chart__legend">
              {series.map((s, j) => (
                <span key={s.key} className="kl-chart__key">
                  <i style={{ background: seriesColor(j) }} />
                  {s.label}
                </span>
              ))}
            </span>
          )}
        </figcaption>
      )}
      <div ref={container} className="kl-chart__plot">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={i18n.t("chart.label", { title: block.title ?? i18n.t("chart.defaultTitle"), count: n })}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <g className="kl-chart__grid">
            {ticks.map((tick) => (
              <Fragment key={tick}>
                <line x1={margin.left} x2={margin.left + inner.width} y1={y(tick)} y2={y(tick)} />
                <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {tickLabel(tick)}
                </text>
              </Fragment>
            ))}
          </g>
          <g className="kl-chart__xlabels">
            {xLabels.map((label) => (
              <text key={label.i} x={xCenter(label.i)} y={HEIGHT - 8} textAnchor="middle">
                {label.text}
              </text>
            ))}
          </g>
          {block.kind === "bar" ? (
            <g>
              {bars.map((bar) => (
                <rect
                  key={bar.key}
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx="2"
                  fill={seriesColor(bar.color)}
                  fillOpacity={hover === null || bar.key.startsWith(`${hover}-`) ? 1 : 0.45}
                />
              ))}
            </g>
          ) : (
            <g>
              {lines.map((line) => (
                <g key={line.key} style={{ color: seriesColor(line.color) }}>
                  {block.kind === "area" && <path d={line.area} fill="currentColor" fillOpacity="0.12" stroke="none" />}
                  <path d={line.path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {line.last && (
                    <circle cx={line.last[0]} cy={line.last[1]} r="3.5" fill="currentColor" stroke="var(--kl-surface)" strokeWidth="2" />
                  )}
                </g>
              ))}
            </g>
          )}
          {tooltip && block.kind !== "bar" && (
            <line className="kl-chart__guide" x1={tooltip.x} x2={tooltip.x} y1={margin.top} y2={margin.top + inner.height} />
          )}
          <line className="kl-chart__baseline" x1={margin.left} x2={margin.left + inner.width} y1={y(0)} y2={y(0)} />
        </svg>
        {tooltip && (
          <div
            className="kl-chart__tooltip"
            style={{ left: `${(tooltip.x / width) * 100}%`, transform: tooltip.left ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
          >
            <strong>{tooltip.title}</strong>
            {tooltip.items.map((item) => (
              <span key={item.label} className="kl-num">
                <i style={{ background: seriesColor(item.color) }} />
                {item.label}: {item.value}
              </span>
            ))}
          </div>
        )}
      </div>
      {block.caption && <p className="kl-chart__caption">{block.caption}</p>}
    </figure>
  );
}
