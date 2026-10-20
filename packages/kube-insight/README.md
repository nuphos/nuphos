# @nuphos/kube-insight

Pure TypeScript facts about Kubernetes objects: a shared health status, rule-based
diagnoses with evidence, and the English sentences for both. The desktop's Kubernetes views render it; agents are meant to read the
same output, so a GUI and an agent never disagree about what is broken.

## Boundary

- **Pure.** Every export is a function of the objects passed in. No I/O, no
  Kubernetes client, no clock (`now` is an input), no runtime dependencies.
  Reading the cluster is the caller's job (`apps/desktop/electron/k8s/diagnosis.ts`).
- **Structural input.** `src/kube.ts` types the slice of the API objects the
  rules read. Plain JSON from the API server and `@kubernetes/client-node`'s
  model classes both fit; timestamps may be strings or `Date`s.
- **Plain JSON output.** Results cross Electron IPC and MCP unchanged.
- **No prose in rules.** Rules emit `Message`s (key + params); `src/i18n`
  turns them into sentences. Every key exists in every catalog (tested); only
  `en` ships today, matching the Desktop UI.
- **No Secret values.** Rules read the kubelet's own words (waiting messages,
  events). Evidence names a Secret or ConfigMap, never its data, and callers
  never need to read one.
- **One public entry.** Import from `src/index.ts` only. Module folders do not
  reach into each other's internals, and `bun run check:cycles` keeps the
  package free of import cycles.

## Modules

| Module     | Exports                                                                                 | Purpose                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `status`   | `podHealth`, `workloadHealth`, `HEALTH_STATUSES`, `HealthResult`                        | Argo CD's health set: Healthy / Progressing / Degraded / Suspended / Missing / Unknown. Who manages an object is a separate concern. |
| `diagnose` | `diagnose`, `BUILTIN_RULES`, `Rule`, `Diagnosis`, `Evidence`, `SEVERITIES`, `FIX_KINDS` | Rules over pods and their events. Severity lives here only.                                                                          |
| `i18n`     | `translate`, `renderMessage`, `CATALOGS`, `LOCALES`                                     | The `en` catalog for rule, status and card strings.                                                                                  |

Later modules from the roadmap (`ownership`, `plan`, `projection`, `gaps`) get
their own folder and are re-exported from `src/index.ts`.

## Rules

`BUILTIN_RULES` is an explicit array; nothing registers itself on import. A
rule has a stable kebab-case `id`, a default `severity`, a `fixKind`, at least
one `sources` link, the `messageKeys` it may emit, and a pure `check(pod
context) → findings`. `diagnose(input, { rules, severity, disabled })` runs
them, folds the same finding across a workload's pods into one diagnosis, and
sorts by severity.

| Rule             | Finds                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `unschedulable`  | Pending pod the scheduler cannot place (PodScheduled=False/Unschedulable or FailedScheduling): cpu, memory, volume, placement |
| `image-pull`     | ErrImagePull / ImagePullBackOff / InvalidImageName / ErrImageNeverPull, classified from the registry's answer                 |
| `config-missing` | CreateContainerConfigError for a missing Secret / ConfigMap or key, and FailedMount for a volume from a missing one           |
| `out-of-memory`  | OOMKilled, with and without a memory limit                                                                                    |
| `crash-loop`     | Restarting container read from its restart count and last exit code (126, 127, 137, 143, 0 and others)                        |
| `probe-failure`  | Recent liveness / readiness / startup Unhealthy events, with the probe's timing                                               |

`fixKind` is one of `plan`, `export-patch`, `suggest-install`,
`request-access` (actionable kinds for later iterations) or `inspect-logs`,
`edit-config` (the fix sentence is guidance).

## Fixtures

`fixtures/<area>/<case>/` holds `case.json` (description, operation, params),
`input.json` (Kubernetes objects) and `expected.json`. `src/fixtures.test.ts`
runs every case, and every built-in rule must fire in at least one. After an
intended change, regenerate and review the diff:

```sh
KUBE_INSIGHT_UPDATE_FIXTURES=1 node --experimental-strip-types --test "src/**/*.test.ts"
```

## Development

```sh
node --experimental-strip-types --test "src/**/*.test.ts"   # tests
../../apps/desktop/node_modules/.bin/tsc -p tsconfig.json   # strict typecheck
```

The desktop's `pnpm test` and CI's desktop job run both.

## License

Apache-2.0, as the rest of the repository.
