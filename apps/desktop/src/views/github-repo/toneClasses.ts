import type { StatusTone } from './pullRequestChecks'

export const TONE_BADGE: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success ring-success/20',
  error: 'bg-error/10 text-error ring-error/20',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  neutral: 'bg-zGray-800/60 text-secondary ring-zGray-700/50',
  merged: 'bg-zViolet-accent/10 text-zViolet-accent ring-zViolet-accent/20',
}

export const TONE_CIRCLE: Record<StatusTone, string> = {
  success: 'bg-success text-white',
  error: 'bg-error text-white',
  warning: 'bg-warning text-white',
  neutral: 'bg-zGray-500 text-white',
  merged: 'bg-zViolet-500 text-white',
}
