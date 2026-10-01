import { healthClass, k8sStatusTone, podTone, readinessTone, replicaTone } from '../lib/k8sHealth'

import { StatusBadge } from './StatusBadge'

export function ReadyCount({ value, status }: { value: string; status?: string }) {
  const tone = status == null ? readinessTone(value) : podTone(status, value)

  return <span className={healthClass[tone]}>{value}</span>
}

export function ReplicaCount({ value, desired }: { value: number; desired: number }) {
  return (
    <span
      className={healthClass[replicaTone(value, desired)]}
      title={`${String(value)} / ${String(desired)} desired`}
    >
      {value}
    </span>
  )
}

export function PodStatus({ status, ready }: { status: string; ready: string }) {
  return <StatusBadge status={status} tone={podTone(status, ready)} />
}

export function K8sStatus({ status }: { status: string }) {
  return <StatusBadge status={status} tone={k8sStatusTone(status)} />
}
