import clsx from 'clsx'
import { useEffect, useRef } from 'react'

function usePlanReveal<T extends HTMLElement>(revealKey: string | number) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current

    if (!el) return
    el.classList.remove('is-hiding', 'is-shown')
    el.getBoundingClientRect() // force the reflow that starts the enter transition
    const frame = requestAnimationFrame(() => el.classList.add('is-shown'))

    return () => cancelAnimationFrame(frame)
  }, [revealKey])

  return ref
}

export function PlanRevealSection({
  revealKey,
  className,
  children,
}: {
  revealKey: string | number
  className?: string
  children: React.ReactNode
}) {
  const ref = usePlanReveal<HTMLDivElement>(revealKey)

  return (
    <div ref={ref} className="t-stagger t-plan-reveal">
      <div className="t-stagger-line t-stagger-line--1">
        <div className={className}>{children}</div>
      </div>
    </div>
  )
}

export function PlanRevealItem({
  revealKey,
  className,
  children,
}: {
  revealKey: string | number
  className?: string
  children: React.ReactNode
}) {
  const ref = usePlanReveal<HTMLLIElement>(revealKey)

  return (
    <li ref={ref} className={clsx('t-stagger t-plan-reveal', className)}>
      <div className="t-stagger-line t-stagger-line--1">{children}</div>
    </li>
  )
}
