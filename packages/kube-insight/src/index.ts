// Public surface of @nuphos/kube-insight. Consumers import from here only; the
// module folders (status, diagnose, i18n) never import each other's internals.

export * from './diagnose/index.ts'
export * from './i18n/index.ts'
export * from './status/index.ts'

export { message } from './message.ts'

export type { Message } from './message.ts'
export type {
  Container,
  ContainerStatus,
  DaemonSet,
  Deployment,
  Job,
  KubeEvent,
  Pod,
  StatefulSet,
  Workload,
} from './kube.ts'
