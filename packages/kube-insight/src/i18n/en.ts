import type { Catalog } from './types.ts'

// Diagnosis sentences for SRE readers: Kubernetes terms stay as they are.

const withOutput = (p: Record<string, string>) => (p.output ? `: ${p.output}` : '.')

export const en: Catalog = {
  'card.title': 'Diagnosis',
  'card.why': 'Why',
  'card.fix': 'Fix',
  'card.evidence': 'Evidence',
  'card.sources': 'Sources',
  'card.pods': 'Pods',
  'card.previousLogs': 'View previous logs',
  'card.more': '{count} more',

  'severity.critical': 'Critical',
  'severity.warning': 'Warning',
  'severity.info': 'Info',

  'fixKind.plan': 'Change plan',
  'fixKind.export-patch': 'Export patch',
  'fixKind.suggest-install': 'Install suggestion',
  'fixKind.request-access': 'Request access',
  'fixKind.inspect-logs': 'Read the logs',
  'fixKind.edit-config': 'Change the config',

  'status.Healthy': 'Healthy',
  'status.Progressing': 'Progressing',
  'status.Degraded': 'Degraded',
  'status.Suspended': 'Suspended',
  'status.Missing': 'Missing',
  'status.Unknown': 'Unknown',

  'health.missing': 'The object does not exist.',
  'health.pod.terminating': 'The pod is terminating.',
  'health.pod.pending': 'The pod is pending.',
  'health.pod.failed': 'The pod failed: {reason}.',
  'health.pod.waiting': '{reason} · {container} · {restarts} restarts',
  'health.pod.notReady': '{ready}/{total} containers ready',
  'health.workload.paused': 'The rollout is paused.',
  'health.workload.generation': 'The controller has not observed the latest spec yet.',
  'health.workload.deadline': 'The rollout exceeded its progress deadline: {message}',
  'health.workload.updating': '{updated}/{desired} replicas updated',
  'health.workload.available': '{available}/{desired} replicas available',
  'health.job.failed': 'The job failed: {reason}.',
  'health.job.suspended': 'The job is suspended.',
  'health.job.running': '{active} pods running',

  'diagnosis.crashLoop.cause.exitCode': '{container} keeps crashing (exit code {exitCode}).',
  'diagnosis.crashLoop.cause.exitsZero': '{container} keeps exiting with code 0 and restarting.',
  'diagnosis.crashLoop.cause.notExecutable':
    "{container} can't run its command: the file is not executable (exit code 126).",
  'diagnosis.crashLoop.cause.commandNotFound':
    "{container} can't run its command: it is not in the image (exit code 127).",
  'diagnosis.crashLoop.cause.killed':
    '{container} keeps being killed with SIGKILL (exit code 137).',
  'diagnosis.crashLoop.cause.terminated':
    '{container} keeps being stopped with SIGTERM (exit code 143).',
  'diagnosis.crashLoop.why.backOff':
    'It has restarted {restarts} times. The kubelet restarts it with an exponential back-off, capped at 5 minutes.',
  'diagnosis.crashLoop.why.exitsZero':
    'With restartPolicy Always the kubelet restarts a container whenever its process ends, even cleanly ({restarts} times so far).',
  'diagnosis.crashLoop.fix.logs': 'The error is in the logs of the run before the restart.',
  'diagnosis.crashLoop.fix.exitsZero':
    'A long-running workload must keep its process running; run one-off work as a Job.',
  'diagnosis.crashLoop.fix.command': "Check the image's entrypoint, command and args.",
  'diagnosis.crashLoop.fix.killed':
    'Something sent SIGKILL: check memory use, the liveness probe and node events.',
  'diagnosis.crashLoop.fix.terminated': 'Check the liveness probe and what else stops the process.',

  'diagnosis.outOfMemory.cause.limit': '{container} was OOMKilled at its memory limit of {limit}.',
  'diagnosis.outOfMemory.cause.noLimit':
    '{container} was OOMKilled because the node ran short of memory.',
  'diagnosis.outOfMemory.why.limit':
    'A container may use at most {limit}; above it the kernel kills the process immediately, and it cannot catch the signal.',
  'diagnosis.outOfMemory.why.noLimit':
    'With no memory limit it can grow until the node runs short; the kernel OOM killer then stops the biggest consumers.',
  'diagnosis.outOfMemory.fix.limit':
    'Raise the memory limit, or find what uses the memory ({restarts} restarts so far).',
  'diagnosis.outOfMemory.fix.noLimit':
    'Set a memory request and limit that fit what it uses ({restarts} restarts so far).',

  'diagnosis.imagePull.cause.notFound':
    "{container} can't pull {image}: the registry has no such image.",
  'diagnosis.imagePull.cause.notFoundOrPrivate':
    "{container} can't pull {image}: it does not exist, or it is private.",
  'diagnosis.imagePull.cause.unauthorized':
    "{container} can't pull {image}: the registry refused the credentials.",
  'diagnosis.imagePull.cause.rateLimited':
    "{container} can't pull {image}: the registry is rate limiting pulls.",
  'diagnosis.imagePull.cause.unreachable':
    "{container} can't pull {image}: the registry can't be reached.",
  'diagnosis.imagePull.cause.invalidName': "{container}'s image name {image} is invalid.",
  'diagnosis.imagePull.cause.neverPull':
    '{container} uses imagePullPolicy Never, and {image} is not on the node.',
  'diagnosis.imagePull.cause.unknown': "{container} can't pull {image}.",
  'diagnosis.imagePull.why':
    'The kubelet pulls the image before it starts the container, and retries with a growing back-off until the pull succeeds.',
  'diagnosis.imagePull.fix.notFound': "Check the image's repository and tag.",
  'diagnosis.imagePull.fix.notFoundOrPrivate':
    'Check the repository and tag; if the image is private, add an imagePullSecret for its registry.',
  'diagnosis.imagePull.fix.unauthorized':
    'Add an imagePullSecret for the registry, or fix the one the pod uses.',
  'diagnosis.imagePull.fix.rateLimited': 'Authenticate to the registry, or pull through a mirror.',
  'diagnosis.imagePull.fix.unreachable':
    "Check the node's network, DNS and egress to the registry.",
  'diagnosis.imagePull.fix.invalidName': 'Fix the image reference.',
  'diagnosis.imagePull.fix.neverPull':
    'Load the image onto the node, or change imagePullPolicy to IfNotPresent.',
  'diagnosis.imagePull.fix.unknown': "The pod's events have the registry's full answer.",

  'diagnosis.unschedulable.cause.cpu': "The pod can't be scheduled: no node has enough CPU free.",
  'diagnosis.unschedulable.cause.memory':
    "The pod can't be scheduled: no node has enough memory free.",
  'diagnosis.unschedulable.cause.volume':
    "The pod can't be scheduled: a PersistentVolumeClaim is unbound or pins it to unavailable nodes.",
  'diagnosis.unschedulable.cause.placement':
    "The pod can't be scheduled: no node matches its selectors, affinity or tolerations.",
  'diagnosis.unschedulable.cause.other': "The pod can't be scheduled on any node.",
  'diagnosis.unschedulable.why':
    'The scheduler places a pod only on a node that fits its requests and constraints. It says: {message}',
  'diagnosis.unschedulable.fix.cpu': 'Lower the CPU request, run fewer replicas, or add nodes.',
  'diagnosis.unschedulable.fix.memory':
    'Lower the memory request, run fewer replicas, or add nodes.',
  'diagnosis.unschedulable.fix.volume':
    "Check the PersistentVolumeClaim's status, its StorageClass and the volume's node affinity.",
  'diagnosis.unschedulable.fix.placement':
    'Check nodeSelector, affinity and tolerations against the nodes and their taints.',
  'diagnosis.unschedulable.fix.other':
    "The FailedScheduling event has the scheduler's full answer.",

  'diagnosis.configMissing.cause.object':
    "{container} can't start: {object} {name} does not exist.",
  'diagnosis.configMissing.cause.key': "{container} can't start: {object} {name} has no key {key}.",
  'diagnosis.configMissing.cause.unknown':
    "{container} can't start: a Secret or ConfigMap it reads is missing.",
  'diagnosis.configMissing.cause.volume':
    "{pod} can't start: volume {volume} comes from {object} {name}, which does not exist.",
  'diagnosis.configMissing.why':
    'The kubelet starts a container only once every Secret and ConfigMap it reads, and every key it names, exists (CreateContainerConfigError).',
  'diagnosis.configMissing.why.volume':
    'The kubelet mounts every volume before it starts the containers; a volume from a missing object never mounts, so they stay in ContainerCreating.',
  'diagnosis.configMissing.fix.object':
    'Create {object} {name} in this namespace, or stop referencing it.',
  'diagnosis.configMissing.fix.key':
    'Add key {key} to {object} {name}, or mark the reference optional.',
  'diagnosis.configMissing.fix.unknown': "The container's waiting message names what is missing.",
  'diagnosis.configMissing.fix.volume':
    'Create {object} {name} in this namespace, or remove volume {volume}.',

  'diagnosis.probeFailure.cause.liveness': (p) =>
    `${p.container}'s liveness probe failed ${p.count} times${withOutput(p)}`,
  'diagnosis.probeFailure.cause.readiness': (p) =>
    `${p.container}'s readiness probe failed ${p.count} times${withOutput(p)}`,
  'diagnosis.probeFailure.cause.startup': (p) =>
    `${p.container}'s startup probe failed ${p.count} times${withOutput(p)}`,
  'diagnosis.probeFailure.why.liveness':
    'The kubelet probes every {period}s and restarts the container after {threshold} failures in a row (about {total}s).',
  'diagnosis.probeFailure.why.readiness':
    'The kubelet probes every {period}s; after {threshold} failures in a row (about {total}s) the pod is removed from Service endpoints until it passes again.',
  'diagnosis.probeFailure.why.startup':
    'The container has {threshold} × {period}s ({total}s) to pass its startup probe; then the kubelet restarts it.',
  'diagnosis.probeFailure.fix.liveness':
    "Check the liveness probe's path, port and timing; a probe that is too strict restarts a healthy process.",
  'diagnosis.probeFailure.fix.readiness':
    "Check the readiness probe's path, port and timing, and whether the app's dependencies are up.",
  'diagnosis.probeFailure.fix.startup':
    'If the app just starts slowly, raise failureThreshold or periodSeconds; otherwise its logs say why.',
}
