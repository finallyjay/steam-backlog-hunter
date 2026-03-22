"use client"

import { useEffect, useMemo, useRef, useState } from "react"

type AnimatedNumberProps = {
  value: number
  className?: string
  durationMs?: number
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
const DIGIT_HEIGHT_EM = 1.05

function shortestCircularOffset(digit: number, activeDigit: number) {
  const raw = digit - activeDigit
  if (raw > 5) return raw - 10
  if (raw < -5) return raw + 10
  return raw
}

function DigitColumn({
  digit,
  previousDigit,
  durationMs,
}: {
  digit: string
  previousDigit: string
  durationMs: number
}) {
  const targetDigit = Number(digit)
  const startDigit = Number(previousDigit)
  const [activeDigit, setActiveDigit] = useState(startDigit)

  useEffect(() => {
    setActiveDigit(startDigit)
    const frame = window.requestAnimationFrame(() => {
      setActiveDigit(targetDigit)
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [startDigit, targetDigit])

  return (
    <span
      className="relative inline-flex overflow-hidden align-baseline"
      style={{ height: `${DIGIT_HEIGHT_EM}em`, width: "0.72em" }}
    >
      {DIGITS.map((item) => {
        const offset = shortestCircularOffset(Number(item), activeDigit)

        return (
          <span
            key={item}
            className="absolute inset-0 flex items-center justify-end leading-none transition-transform ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              transform: `translateY(${offset * DIGIT_HEIGHT_EM}em)`,
              transitionDuration: `${durationMs}ms`,
            }}
          >
            {item}
          </span>
        )
      })}
    </span>
  )
}

export function AnimatedNumber({
  value,
  className,
  durationMs = 1400,
}: AnimatedNumberProps) {
  const previousValueRef = useRef(0)
  const hasMountedRef = useRef(false)
  const previousValue = hasMountedRef.current ? previousValueRef.current : 0

  const formatter = useMemo(
    () => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
    [],
  )

  const formattedCurrent = formatter.format(value)
  const formattedPrevious = formatter.format(previousValue)
  const maxLength = Math.max(formattedCurrent.length, formattedPrevious.length)
  const paddedCurrent = formattedCurrent.padStart(maxLength, " ")
  const paddedPrevious = formattedPrevious.padStart(maxLength, " ")

  useEffect(() => {
    previousValueRef.current = value
    hasMountedRef.current = true
  }, [value])

  return (
    <span className={`inline-flex items-baseline tabular-nums ${className ?? ""}`}>
      {paddedCurrent.split("").map((char, index) => {
        const previousChar = paddedPrevious[index] ?? " "

        if (!/\d/.test(char)) {
          return (
            <span key={`sep-${index}`} className="inline-flex min-w-[0.3em] justify-center">
              {char === " " ? "" : char}
            </span>
          )
        }

        const safePreviousDigit = /\d/.test(previousChar) ? previousChar : "0"

        return (
          <DigitColumn
            key={`digit-${index}-${char}-${safePreviousDigit}`}
            digit={char}
            previousDigit={safePreviousDigit}
            durationMs={durationMs}
          />
        )
      })}
    </span>
  )
}
