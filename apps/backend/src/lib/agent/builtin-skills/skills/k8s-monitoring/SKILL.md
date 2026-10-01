---
name: k8s-monitoring
description: Set up cluster-internal health monitoring (Deployments, Nodes, CronJobs, PVCs, certs) using the industry-standard kube-prometheus-stack pipeline, alerting into the team's Better Stack via its official Prometheus integration. Use when the user asks to "monitor my cluster", "set up cluster monitoring", or wants alerts for resources that have no public endpoint.
---

# K8s cluster monitoring

Cluster-internal resources (Deployments, StatefulSets, DaemonSets, Pods,
Nodes, Services, PVCs, cert-manager Certificates, CronJobs) have no public
endpoint, so external uptime probes can't see them. The supported path is
the standard pipeline, with the alert egress pointed at the team's own
Better Stack:

```
kube-state-metrics → Prometheus → Alertmanager ──→ Better Stack Prometheus
   (k8s SIG)         (rules eval)      │            webhook → incident
                                       └─ Watchdog → Better Stack heartbeat
                                          (always-firing; if it stops the
                                           heartbeat misses ⇒ incident ⇒
                                           "the monitoring pipeline itself
                                           died" is also covered)
```

Zero Nuphos-owned components run in the cluster — everything is CNCF
standard. Incidents land in the team's Better Stack, so alert channels
(Slack / SMS / phone) are configured once there, and Nuphos's Monitoring
page aggregates them automatically.

## Step 0: figure out what already exists

```bash
# Is there already a Prometheus / Alertmanager in the cluster?
kubectl get pods -A | grep -iE 'prometheus|alertmanager|kube-state-metrics|victoria'
helm list -A | grep -iE 'prometheus|kube-prometheus'
```

Three situations:

| Found | Action |
|---|---|
| Nothing | Full install (step 2) |
| kube-prometheus-stack already installed | Config-only: add the Better Stack receiver + rules (steps 1, 3, 4) via `helm upgrade --reuse-values` |
| A different stack (VictoriaMetrics, vanilla Prometheus, …) | Don't replace it — wire its existing alerting path to Better Stack. Ask the user before touching an existing stack. VictoriaMetrics specifics below. |

**VictoriaMetrics coexist path** (the victoria-metrics-k8s-stack layout —
VMAgent scrapes, VMAlert evaluates, Alertmanager routes):

- The egress is identical: VMAlert already sends to an Alertmanager, so
  step 3's receiver config applies unchanged — add the Better Stack
  receiver + Watchdog route to THAT Alertmanager's config (usually a
  `VMAlertmanagerConfig` or the alertmanager secret, depending on how the
  stack was installed).
- The Nuphos rules pack (step 4) applies as-is: the VictoriaMetrics
  operator auto-converts `PrometheusRule` CRs to `VMRule` when
  `--controller.useCustomConfigReloader` conversion is enabled (it is by
  default in victoria-metrics-k8s-stack). Verify after applying:
  `kubectl get vmrules -A | grep nuphos`.
- The chart ships the same community alert rules as kube-prometheus-stack
  (converted), including `Watchdog` — the heartbeat route works the same.

## Step 1: create the Better Stack side (webhook + watchdog heartbeat)

Both live in the team's own Better Stack account — use the `betterstack`
skill's credentials setup first.

1. **Prometheus webhook URL** — stored on the team's Better Stack
   binding; the user should never have to know it exists. Resolution
   order:

   1. After running the `betterstack` skill's credentials setup, check
      `$BETTERSTACK_PROMETHEUS_WEBHOOK_URL` — for managed-onboarding
      teams Zeabur pre-configures this, so it's usually already there.
      Use it and move on.
   2. Empty? This is a **one-time manual step per BS team** (verified:
      the public API can only create generic webhooks, which accept
      Alertmanager payloads but don't parse them into incidents). Walk
      the user through it: Better Stack dashboard → Integrations →
      Importing data → "Prometheus Alertmanager" → Add, then have them
      paste back the webhook URL
      (`https://uptime.betterstack.com/api/v1/prometheus/webhook/<id>`).
   3. **Save it back to the binding** so no one ever pastes it again:

      ```bash
      ac "/teams/$TEAM/betterstack-integrations/$BETTERSTACK_INTEGRATION_ID" \
        -X PATCH -H 'Content-Type: application/json' \
        -d '{"prometheusWebhookUrl": "<the URL>"}'
      ```

      (Requires team-admin; if the PATCH is rejected, continue with the
      URL for this session and tell the user an admin should save it.)
2. **Watchdog heartbeat** — create via API:

```bash
curl -s -X POST https://uptime.betterstack.com/api/v2/heartbeats \
  -H "Authorization: Bearer $BETTERSTACK_UPTIME_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "kube-prometheus watchdog — <cluster name>", "period": 300, "grace": 300}'
# → response.data.attributes.url is the heartbeat URL
```

Period 300/grace 300: the Watchdog alert repeats roughly every few
minutes; 5m+5m tolerates one missed delivery without a false page.

## Step 2: install kube-prometheus-stack (when absent)

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set grafana.enabled=false \
  --values /tmp/alertmanager-values.yaml   # from step 3
```

`grafana.enabled=false` because the team views state through Better Stack
and Nuphos; skip it unless the user asks. Everything else (KSM,
node-exporter, default rules, Alertmanager) ships enabled.

Confirm with the user before installing — state the namespace, the chart,
and the ~700Mi memory footprint of a default install.

## Step 3: wire Alertmanager to Better Stack

Write `/tmp/alertmanager-values.yaml` (helm values for the chart above;
for an existing install, `helm upgrade kube-prometheus ... --reuse-values
--values /tmp/alertmanager-values.yaml`):

```yaml
alertmanager:
  config:
    route:
      receiver: betterstack
      routes:
        # Watchdog goes to the heartbeat, NOT the incident webhook —
        # it is always-firing by design and must never page anyone.
        - receiver: watchdog-heartbeat
          matchers:
            - alertname = "Watchdog"
          repeat_interval: 2m
    receivers:
      - name: betterstack
        webhook_configs:
          - url: <PROMETHEUS WEBHOOK URL from step 1>
            send_resolved: true
      - name: watchdog-heartbeat
        webhook_configs:
          - url: <HEARTBEAT URL from step 1>
            send_resolved: false
```

`send_resolved: true` on the incident receiver lets Better Stack
auto-resolve incidents when the alert clears.

## Step 4: the Nuphos rules pack

kube-prometheus-stack's defaults already cover most of what matters
(KubeDeploymentReplicasMismatch, KubePodCrashLooping, KubeNodeNotReady,
KubePersistentVolumeFillingUp, …). Apply the Nuphos supplement for the
gaps (CronJob staleness, cert-manager expiry, endpoint-less Services):

```bash
kubectl apply -f skills/k8s-monitoring/references/nuphos-rules.yaml
```

Read that file before applying so you can tell the user exactly which
alerts it adds. It's a standard `PrometheusRule` CR — the operator picks
it up automatically (label `release: kube-prometheus` must match the helm
release name; edit if the user installed under a different name).

## Step 5: verify end-to-end

```bash
# 1. Pipeline up?
kubectl -n monitoring get pods
# 2. Watchdog flowing? (check the BS heartbeat shows a recent ping)
# 3. Force a real incident: scale a throwaway Deployment to 0 replicas
kubectl create deployment monitoring-canary --image=nginx -n default
kubectl scale deployment monitoring-canary --replicas=3 -n default
kubectl scale deployment monitoring-canary --replicas=0 -n default   # mismatch fires in ~15m
# … confirm the incident appears in Better Stack, then clean up:
kubectl delete deployment monitoring-canary -n default
```

Fastest verification — inject a synthetic alert straight into
Alertmanager (validates the Alertmanager → Better Stack → incident leg
in under a minute, no `for:` window to wait out):

```bash
kubectl -n monitoring port-forward svc/<release>-kube-prometheus-alertmanager 19093:9093 &
curl -s -X POST http://localhost:19093/api/v2/alerts -H 'Content-Type: application/json' -d "[{
  \"labels\": {\"alertname\": \"SyntheticE2ETest\", \"severity\": \"critical\"},
  \"annotations\": {\"summary\": \"Pipeline verification — safe to ignore\"},
  \"startsAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}]"
# → incident appears in Better Stack within ~1 minute. Resolve it via the
#   incidents API afterwards.
```

Caveat on the crash-canary approach: CrashLoopBackOff backoff grows
exponentially, so the restart RATE can fall below
`KubePodCrashLooping`'s threshold before its 15m window completes — the
alert may sit in `pending` indefinitely. Prefer the synthetic injection
above for pipeline verification; reserve the canary for verifying rule
EVALUATION specifically.

Remember the full-cluster scan implication: once installed, REAL alerts
(CPU throttling, stuck daemonsets, stale cronjobs) will start opening
incidents in the team's Better Stack within ~15-30 minutes. For a
test install, clean up promptly and resolve any incidents the test
stack opened (uninstalling removes Alertmanager, so nothing will ever
send the resolved notification — they must be resolved via API/UI).

## Optional: in-cluster probing with Blackbox Exporter

kube-state-metrics only sees DECLARED state ("endpoints ready"). For
end-to-end proof that an internal Service actually answers (HTTP 200 over
its ClusterIP — what Better Stack does for public URLs, but from inside
the cluster), add Blackbox Exporter. Offer it when the user asks to
"monitor" internal HTTP services specifically, not by default:

```bash
helm install blackbox prometheus-community/prometheus-blackbox-exporter \
  --namespace monitoring
```

Then a probe scrape + alert per target (works with both Prometheus and
VMAgent — for the latter use a `VMProbe` CR instead of the scrape config):

```yaml
# Scrape config (Prometheus) — probe an internal service:
- job_name: blackbox-internal
  metrics_path: /probe
  params: { module: [http_2xx] }
  static_configs:
    - targets: ["http://my-svc.my-ns.svc:8080/healthz"]
  relabel_configs:
    - source_labels: [__address__]
      target_label: __param_target
    - source_labels: [__param_target]
      target_label: instance
    - target_label: __address__
      replacement: blackbox-prometheus-blackbox-exporter.monitoring:9115
```

```yaml
# Alert: the probe itself fails ⇒ the service is not answering.
- alert: NuphosInternalProbeFailed
  expr: probe_success == 0
  for: 5m
  labels: { severity: critical }
  annotations:
    summary: 'Internal probe {{ $labels.instance }} is failing'
```

## Safety rules

- Confirm before `helm install` / `helm upgrade` / applying rules —
  state what, where, and the resource cost.
- Never replace an existing monitoring stack without explicit user
  approval; prefer config-only additions.
- The Better Stack token stays in the env set up by the `betterstack`
  skill; never print it.
- If the team has no Better Stack integration bound, stop and point the
  user to Integrations (or Zeabur-managed onboarding) first — there is
  nowhere to send the alerts otherwise.
