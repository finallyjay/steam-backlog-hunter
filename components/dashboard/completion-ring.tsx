"use client"

import { useEffect, useId, useState } from "react"

import { AnimatedNumber } from "@/components/ui/animated-number"

interface CompletionRingProps {
  percent: number
  size?: number
}

// Animated circular progress ring for the dashboard hero stat. The dasharray
// transitions from 0 to the target percent on mount, creating a "filling up"
// effect that anchors the dashboard's first visual moment.
export function CompletionRing({ percent, size = 96 }: CompletionRingProps) {
  // Tick after mount so the CSS transition runs from 0 → target.
  const [animatedPercent, setAnimatedPercent] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setAnimatedPercent(percent), 50)
    return () => clearTimeout(t)
  }, [percent])

  const r = 42
  const c = 2 * Math.PI * r
  const filled = (animatedPercent / 100) * c
  const gap = c - filled

  // Unique gradient id per instance to avoid collisions if the component is
  // rendered more than once on the same page.
  const uid = useId()
  const gradId = `completion-ring-grad-${uid}`

  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle cx="50" cy="50" r={r} fill="none" className="stroke-surface-4" strokeWidth="6" />
        {/* Progress */}
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${gap}`}
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-foreground inline-flex items-baseline text-2xl font-semibold tracking-tight">
          <AnimatedNumber value={Math.round(percent)} />
          <span className="text-muted-foreground ml-0.5 text-sm">%</span>
        </span>
        <span className="text-muted-foreground text-2xs tracking-eyebrow mt-0.5 font-semibold uppercase">Avg</span>
      </div>
    </div>
  )
}
