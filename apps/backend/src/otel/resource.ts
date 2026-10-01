import { Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

import { config } from '@/config'

// resource.ts — the immutable label set every span/metric/log emitted by this
// process is tagged with. Resource attributes are how observability backends
// answer "which service / version / pod produced this signal", so getting them
// right once here saves wiring them onto individual instruments later.
export function buildResource() {
  const o = config.otel

  return new Resource({
    [ATTR_SERVICE_NAME]: o.serviceName,
    [ATTR_SERVICE_VERSION]: o.serviceVersion,
    // semconv keys that don't have a stable export from the package yet —
    // hard-coded strings keep us off the moving-target experimental list.
    'service.namespace': 'atlas',
    'service.instance.id': o.podName ?? String(process.pid),
    'deployment.environment.name': o.deploymentEnvironment,
    'deployment.environment': o.deploymentEnvironment,
    ...(o.podName ? { 'k8s.pod.name': o.podName } : {}),
    ...(o.podNamespace ? { 'k8s.namespace.name': o.podNamespace } : {}),
    ...(o.nodeName ? { 'k8s.node.name': o.nodeName } : {}),
    'process.runtime.name': 'bun',
    'process.runtime.version': typeof Bun !== 'undefined' ? Bun.version : '',
    'process.pid': process.pid,
    ...o.resourceAttributes,
  })
}
