import { useState, type ReactNode } from 'react'

export interface Segment {
  key: string
  value: number
  /** CSS color (or var()) for the fill. */
  color: string
  /** Series name shown in tooltip. */
  seriesLabel?: string
}

export interface BarRow {
  key: string
  label: string
  sublabel?: string
  segments: Segment[]
  /** Optional override for the value shown at the end of the bar. */
  valueLabel?: string
  onClick?: () => void
}

/**
 * Horizontal bar chart built in plain HTML. Marks are thin, segments carry a 2px
 * surface gap, data-ends are rounded, and every segment has a hover tooltip.
 * Handles single-series (one segment) and stacked multi-series rows.
 */
export function HBarChart({
  rows,
  max,
  unit,
  labelWidth = 190,
}: {
  rows: BarRow[]
  max?: number
  unit?: string
  labelWidth?: number
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const computedMax = max ?? Math.max(1, ...rows.map((r) => r.segments.reduce((n, s) => n + s.value, 0)))

  return (
    <div className="hbar" onMouseLeave={() => setTip(null)}>
      {rows.map((row) => {
        const total = row.segments.reduce((n, s) => n + s.value, 0)
        return (
          <div
            key={row.key}
            className={`hbar__row${row.onClick ? ' hbar__row--click' : ''}`}
            style={{ gridTemplateColumns: `${labelWidth}px 1fr auto` }}
            onClick={row.onClick}
          >
            <div className="hbar__label">
              <div className="hbar__label-main" title={row.label}>{row.label}</div>
              {row.sublabel && <div className="hbar__label-sub">{row.sublabel}</div>}
            </div>
            <div className="hbar__track">
              {row.segments.map((seg) =>
                seg.value > 0 ? (
                  <div
                    key={seg.key}
                    className="hbar__seg"
                    style={{ width: `${(seg.value / computedMax) * 100}%`, background: seg.color }}
                    onMouseMove={(e) =>
                      setTip({
                        x: e.clientX,
                        y: e.clientY,
                        text: `${seg.seriesLabel ? `${seg.seriesLabel}: ` : ''}${seg.value}${unit ? ` ${unit}` : ''}`,
                      })
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                ) : null,
              )}
            </div>
            <div className="hbar__value">{row.valueLabel ?? total}</div>
          </div>
        )
      })}
      {tip && (
        <div className="viz-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="viz-legend">
      {items.map((it) => (
        <span key={it.label} className="viz-legend__item">
          <span className="viz-legend__swatch" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export function ChartCard({
  title,
  subtitle,
  legend,
  children,
}: {
  title: string
  subtitle?: string
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="chart-card">
      <div className="chart-card__head">
        <div>
          <h3 className="chart-card__title">{title}</h3>
          {subtitle && <p className="chart-card__sub">{subtitle}</p>}
        </div>
        {legend}
      </div>
      {children}
    </section>
  )
}
