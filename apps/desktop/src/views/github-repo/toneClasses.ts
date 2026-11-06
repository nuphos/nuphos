import type { StatusTone } from './pullRequestChecks'

export const TONE_BADGE: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success ring-success/20',
  error: 'bg-error/10 text-error ring-error/20',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  neutral: 'bg-state-selected text-secondary ring-line-control/50',
  merged: 'bg-state-selected text-primary ring-line-focus',
}

export const TONE_CIRCLE: Record<StatusTone, string> = {
  success: 'bg-success text-white',
  error: 'bg-error text-white',
  warning: 'bg-warning text-white',
  neutral: 'bg-line-control text-white',
  merged: 'bg-action-primary text-inverse',
}
