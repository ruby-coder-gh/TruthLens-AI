import type { ReactNode } from 'react'
import { clsx } from 'clsx'

type Tone = 'neutral' | 'danger' | 'success'

const stateToneClasses: Record<Tone, string> = {
  // `bg-white/[0.02]` was a dark-theme literal: on the light ground it painted
  // an invisible near-white film over an almost-invisible `border-border/60`.
  neutral: 'border-border bg-card-2 text-text-muted',
  danger: 'border-red/30 bg-red/10 text-red',
  success: 'border-green/30 bg-green/10 text-green',
}

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx('space-y-5', className)}>{children}</section>
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={clsx('flex items-start justify-between gap-4', className)}>
      <div>
        <h1 className="text-xl font-bold text-text">{title}</h1>
        {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
      </div>
      {actions}
    </header>
  )
}

export function StateBlock({
  children,
  tone = 'neutral',
  className,
  role,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
  role?: 'status' | 'alert'
}) {
  return (
    <div role={role} className={clsx('rounded-xl border px-4 py-3 text-sm', stateToneClasses[tone], className)}>
      {children}
    </div>
  )
}
