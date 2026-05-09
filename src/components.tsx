import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { teamByCode } from './data'
import type { ChanceLabel, TeamCode } from './types'

/* ------------------------------------------------------------------ */
/* Team monogram — the custom chip that replaces real team logos       */
/* ------------------------------------------------------------------ */

type MonogramSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'

const MONO_SIZE_PX: Record<MonogramSize, number> = {
  xs: 22,
  sm: 30,
  md: 42,
  lg: 60,
  xl: 96,
  xxl: 168,
}

export function TeamMonogram({
  code,
  size = 'sm',
  ringed = false,
  flat = false,
}: {
  code: TeamCode
  size?: MonogramSize
  ringed?: boolean
  flat?: boolean
}) {
  const team = teamByCode.get(code)!
  const px = MONO_SIZE_PX[size]
  const long = code.length >= 4

  return (
    <span
      className={`mono mono-${size}${ringed ? ' mono-ringed' : ''}${flat ? ' mono-flat' : ''}${long ? ' mono-long' : ''}`}
      style={
        {
          '--team-color': team.color,
          '--team-ink': team.ink,
          width: `${px}px`,
          height: `${px}px`,
        } as CSSProperties
      }
      aria-label={team.name}
    >
      <span className="mono-letters">{code}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Pulse Line — the signature ECG of "Playoff Pulse"                  */
/* Beats faster as tension rises. Tension peaks around 50% top-4 odds. */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line react-refresh/only-export-components
export function tensionFromOdds(top4Ratio: number): number {
  // 0% = OUT (calm), 50% = peak tension, 100% = SAFE (calm)
  return 1 - Math.abs(top4Ratio - 0.5) * 2
}

export function PulseLine({
  tension,
  color,
  height = 110,
  flatline = false,
}: {
  tension: number
  color: string
  height?: number
  flatline?: boolean
}) {
  // Faster animation = higher tension. Calm baseline 1.8s, peak 0.55s.
  const duration = flatline ? 2.6 : 1.8 - tension * 1.25

  // The path is a 600-wide ECG cycle. We tile it twice (viewBox 0..1200) and translate -50%.
  const ecgCycle = (offsetX: number) => {
    // Inflated/sharper when tension is high
    const peak = 14 - tension * 8 // tension high → smaller y (higher peak)
    const trough = 86 + tension * 6 // tension high → larger y (deeper trough)
    return [
      `M ${offsetX} 50`,
      `L ${offsetX + 200} 50`,
      `L ${offsetX + 220} 46`,
      `L ${offsetX + 240} 54`,
      `L ${offsetX + 260} 50`,
      `L ${offsetX + 286} 50`,
      `L ${offsetX + 292} 60`,
      `L ${offsetX + 298} ${peak}`,
      `L ${offsetX + 308} ${trough}`,
      `L ${offsetX + 314} 50`,
      `L ${offsetX + 340} 50`,
      `L ${offsetX + 360} 44`,
      `L ${offsetX + 390} 56`,
      `L ${offsetX + 410} 50`,
      `L ${offsetX + 600} 50`,
    ].join(' ')
  }

  const flatPath = `M 0 50 L 1200 50`
  const pathD = flatline ? flatPath : `${ecgCycle(0)} ${ecgCycle(600)}`

  return (
    <div
      className="pulse"
      style={
        {
          '--pulse-color': color,
          '--pulse-duration': `${duration}s`,
          height: `${height}px`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <svg viewBox="0 0 1200 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`pulse-grad-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="pulse-trail" d={pathD} />
        <path className="pulse-glow" d={pathD} />
        <path className="pulse-line" d={pathD} />
      </svg>
      <div className="pulse-baseline" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chance badge — the qualification verdict pill                       */
/* ------------------------------------------------------------------ */

export function ChanceBadge({ label, size = 'md' }: { label: ChanceLabel; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`chance chance-${label} chance-${size}`}>{labelToShort(label)}</span>
}

function labelToShort(label: ChanceLabel) {
  switch (label) {
    case 'safe':
      return 'Through'
    case 'alive':
      return 'Alive'
    case 'hunt':
      return 'In hunt'
    case 'brink':
      return 'On brink'
    case 'out':
      return 'Out'
  }
}

/* ------------------------------------------------------------------ */
/* AnimatedNumber — tweens to its target over ~600ms                  */
/* ------------------------------------------------------------------ */

export function AnimatedNumber({
  value,
  format = (n) => n.toLocaleString(),
  duration = 650,
  className,
}: {
  value: number
  format?: (n: number) => string
  duration?: number
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const targetRef = useRef(value)

  useEffect(() => {
    fromRef.current = display
    targetRef.current = value
    startRef.current = null

    const step = (now: number) => {
      if (startRef.current == null) startRef.current = now
      const t = Math.min(1, (now - startRef.current) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      const next = fromRef.current + (targetRef.current - fromRef.current) * eased
      setDisplay(next)
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  return <span className={className}>{format(display)}</span>
}

/* ------------------------------------------------------------------ */
/* Pill — small label                                                  */
/* ------------------------------------------------------------------ */

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'mute'
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

/* ------------------------------------------------------------------ */
/* Eyebrow — section overline                                          */
/* ------------------------------------------------------------------ */

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="eyebrow">
      <span className="eyebrow-tick" />
      {children}
    </span>
  )
}
