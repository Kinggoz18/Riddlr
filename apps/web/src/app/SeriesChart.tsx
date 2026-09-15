import { useEffect, useMemo, useRef } from "react";
import { NavLink } from "react-router-dom";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export type ChartPoint = { observedAt: string; value: number };
export type ChartMarker = { at: string; href: string; label: string };

function readColor(el: HTMLElement, name: string, fallback: string) {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

function toSeries(points: readonly ChartPoint[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of points) {
    const t = new Date(point.observedAt).getTime() / 1000;
    if (!Number.isFinite(t) || !Number.isFinite(point.value)) {
      continue;
    }
    xs.push(t);
    ys.push(point.value);
  }
  return { xs, ys };
}

function SeriesChart(props: {
  label: string;
  points: readonly ChartPoint[];
  markers?: readonly ChartMarker[];
  empty?: string;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const seriesKey = useMemo(
    () => props.points.map((point) => `${point.observedAt}:${point.value}`).join("|"),
    [props.points],
  );
  const empty = props.points.length === 0 || toSeries(props.points).xs.length === 0;

  useEffect(() => {
    const host = hostRef.current;
    const { xs, ys } = toSeries(props.points);
    if (!host || xs.length === 0) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }
    const height = props.compact ? 140 : 192;
    const draw = () => {
      const width = host.clientWidth;
      if (width < 32) {
        return;
      }
      const colors = {
        stroke: readColor(host, "--mint", "#4edeb3"),
        grid: readColor(host, "--line", "#22312a"),
        axis: readColor(host, "--muted", "#8da097"),
      };
      const axis = {
        stroke: colors.axis,
        grid: { show: !props.compact, stroke: colors.grid },
        ticks: { stroke: colors.grid, size: props.compact ? 4 : 8 },
        font: props.compact ? "10px ui-sans-serif, system-ui, sans-serif" : undefined,
        gap: props.compact ? 4 : 8,
      };
      const first = xs[0] ?? 0;
      const last = ys[0] ?? 0;
      const paddedXs = xs.length === 1 ? [first - 1800, first, first + 1800] : xs;
      const paddedYs = ys.length === 1 ? [last, last, last] : ys;
      plotRef.current?.destroy();
      plotRef.current = new uPlot(
        {
          width,
          height,
          class: "riddlr-uplot",
          legend: { show: false },
          cursor: props.compact
            ? { show: false }
            : { drag: { x: false, y: false }, focus: { prox: 24 } },
          series: [
            {},
            {
              stroke: colors.stroke,
              width: props.compact ? 1.25 : 1.75,
              points: { show: xs.length < 8 },
              spanGaps: false,
            },
          ],
          axes: [
            axis,
            {
              ...axis,
              grid: { stroke: colors.grid },
              size: props.compact ? 44 : undefined,
            },
          ],
          scales: { x: { time: true } },
        },
        [paddedXs, paddedYs],
        host,
      );
    };
    draw();
    const observer = new ResizeObserver(() => {
      const plot = plotRef.current;
      const width = host.clientWidth;
      if (width < 32) {
        return;
      }
      if (!plot) {
        draw();
        return;
      }
      plot.setSize({ width, height });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [props.compact, props.points, seriesKey]);

  const markers = props.markers ?? [];
  return (
    <figure className={`series-chart${props.compact ? " series-chart-compact" : ""}`}>
      <figcaption className="series-chart-label">{props.label}</figcaption>
      {empty ? (
        <p className="series-chart-empty" role="img" aria-label={`${props.label}: no observations`}>
          {props.empty ?? "No observations yet"}
        </p>
      ) : (
        <div
          ref={hostRef}
          className="series-chart-plot"
          role="img"
          aria-label={`${props.label}, ${toSeries(props.points).xs.length} observations`}
        />
      )}
      {!empty && markers.length > 0 ? (
        <ul className="series-chart-markers" aria-label={`${props.label} events`}>
          {markers.map((marker) => (
            <li key={`${marker.href}-${marker.at}`}>
              <NavLink to={marker.href}>{marker.label}</NavLink>
              <time dateTime={marker.at}>{new Date(marker.at).toISOString().slice(0, 10)}</time>
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

export { SeriesChart };
