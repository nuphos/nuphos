---
name: loki
description: Onboard customer VMs (GCP GCE, Tencent CVM, Aliyun ECS/SWAS, Volcengine ECS, anything SSH-able) and Kubernetes clusters into Loki log collection (Grafana Alloy collectors, Loki in the customer's environment) and retrieve logs by time range + keyword through a bound Grafana. Fully agent-driven — inventory, deploy Loki/Grafana when missing, install the collector per target, bind, verify.
---

# Loki — VM & cluster log collection & retrieval

Use this skill when the user wants machine or cluster logs collected into Loki so you can query them precisely instead of SSH-ing around with `cat`, or when they ask you to search logs by time range / keyword. The playbook is provider-agnostic — only the ACCESS layer (credentials, inventory, command channel) differs per provider; everything below the access layer is identical everywhere.

**Architecture (fixed — do not improvise):** the data plane stays entirely inside the customer's project/VPC (Alloy on each target → Loki → its storage). Nuphos only touches the query plane, through a bound Grafana's authenticated proxy (`grafana` skill). Never route log data through Nuphos, and never build a Nuphos-side log store.

**Label convention (fixed):** every collector ships `{env, instance, service}` external labels. `instance` = hostname (node name on clusters), `env` = stage/prod/…, `service` = what runs there. This convention is the substrate for precise retrieval — keep it identical across the fleet, whatever the provider.

## Onboarding playbook

**UX contract — read this first.** The user will say something minimal: "把这台 VM 的日志接进来" or "collect logs from 35.x.x.x so you can search them". They will NOT specify deployment topology, ports, log paths, or labels — discovering those is YOUR job. Never bounce a list of questions back. Instead: discover everything you can (steps 0–0.5), fill the rest with the defaults below, then present ONE consolidated plan message ("here is exactly what I will do: …") for a single yes — and after that yes, execute end-to-end without re-asking unless you hit a genuine surprise that changes scope.

Defaults (state them in the plan; the user overrides by replying, not by being interrogated):
- `env` label: `stage` · `service` label: derived from what the VM runs (discovery) · extra log paths: derived from discovery
- Loki/Grafana placement: a k8s already running on/for those VMs (incl. k3s) > docker on the VM > plain binaries — pick automatically
- Grafana exposure for the Nuphos bind: HTTPS + generated strong password, preferring existing ingress/LB infrastructure over new public ports (switch to a private-access option like GCP IAP only if the user raises private-only requirements)

### 0. Preflight — provider access layer

Credentials come from the MATCHING provider skill (each must be enabled in this session's credential selector): `gcloud` for GCP, `tencent` for Tencent Cloud, `aliyun` for Alibaba Cloud, `volcengine` for Volcengine. For machines outside any bound provider (bare metal, other clouds), plain `ssh` with access the user supplies works the same.

- Inventory via the provider's CLI — e.g. `gcloud compute instances list`, `tccli cvm DescribeInstances`, `aliyun ecs DescribeInstances` (or `aliyun swas-open ListInstances`), `volcengine ecs DescribeInstances`; for cluster targets, list clusters via the provider skill and get the kubeconfig through Nuphos as usual. If the user gave an IP or partial name, resolve it yourself; only ask when genuinely ambiguous.
- Command channel to a VM, in order of preference:
  1. **SSH-style** (supports piping a script over stdin): `gcloud compute ssh <vm> --command "… bash -s" < script`, or plain `ssh user@host "… bash -s" < script` anywhere SSH access exists.
  2. **RunCommand-style** (no stdin): Tencent **TAT** (`tccli tat RunCommand`, base64 content), Aliyun **Cloud Assistant** (`aliyun ecs RunCommand`), Volcengine **ECS Assistant** — embed the rendered script base64 in the command payload. Use these when SSH isn't available.

### 0.5 Discover the target (one read-only probe, no confirmation needed)

Probe before planning — this is what removes the questions. Over whichever command channel applies:

```bash
systemctl is-active k3s 2>/dev/null; command -v docker && docker ps --format "{{.Names}}" 2>/dev/null; \
ls /var/log/containers 2>/dev/null | head -5; ls /var/log/pods 2>/dev/null | head -3; \
systemctl list-units --type=service --state=running --no-pager --no-legend | head -20
```

From the output derive: container runtime (k3s/containerd → include `/var/log/containers/*.log` in EXTRA_LOG_PATHS automatically; docker → `docker ps` names hint the `service` label AND include `/var/lib/docker/containers/*/*-json.log` — docker's json-file logs live there, not in the journal), what the workload is (postgres, app services…), and where Loki/Grafana should live (an on-VM k3s is the preferred deploy target — use `sudo k3s kubectl` over the same channel). For a **cluster** target, discovery is `kubectl get nodes,ns` + a look at what's running — no node SSH.

### 1. Ensure Loki (skip if the customer already has one)

Deploy **monolithic** Loki inside the customer's project. Two options, prefer a Kubernetes cluster when one exists:

- **Any k8s** (GKE/TKE/ACK/VKE/on-VM k3s, via `kubectl` skill): single-replica Deployment of `grafana/loki` with `-target=all`, a PVC for storage, and a Service on 3100 — ClusterIP when the collectors run in this same cluster; when VMs OUTSIDE the cluster push to it, front it with an **internal LoadBalancer** (or equivalent VPC-routable endpoint) instead, never a public one. Filesystem storage on the PVC is fine for stage; for durable/prod suggest switching `storage_config` to the provider's object storage — GCS bucket on GCP, COS on Tencent, OSS on Aliyun, TOS on Volcengine (create via the provider CLI, grant the workload identity object read/write on that bucket only).
- **Plain VM** (over the command channel): `docker run -d --restart=always -p 3100:3100 -v /var/lib/loki:/loki grafana/loki:<version>`.

Always PIN the image to a specific release tag (e.g. `grafana/loki:3.5.0`; check for the current stable) — never `:latest`, which is mutable and makes repeat runs non-reproducible. Same rule for the Grafana image in the next step.

Record the in-VPC Loki URL (e.g. `http://<loki-svc-or-vm-ip>:3100`) — the collectors push to it, so it must be reachable from the target machines (same VPC, or a security-group/firewall rule allowing tcp:3100 from their subnets — add one via the provider CLI after confirming).

### 2. Ensure Grafana + bind it to Nuphos

Retrieval goes through a bound Grafana (`grafana-instances`). **Query-side decision is environment-driven:**

1. **The customer already has a Grafana** (bound to Nuphos, or discovered in their environment): ASK the user whether to attach the new Loki as a datasource there — it's their observability home and they may want everything in one place. Reachability for a REMOTE Grafana: prefer a route that already exists (same cluster/VPC, a tailnet the team operates); otherwise expose the new Loki's **query API only** (`/loki/api/v1/query*`, labels/series endpoints) over HTTPS with basic auth, reusing existing ingress infrastructure where the host already has it — the push endpoint stays internal (local collectors push via localhost/ClusterIP). Get the direction right: the remote Grafana needs QUERY, the local collector does NOT need public push. NEVER introduce tailscale/VPN/subnet-routers just to wire logs.
2. **No Grafana anywhere**: deploy one NEXT TO the new Loki (same VM/k3s/cluster — they talk over localhost/ClusterIP), expose only Grafana (public IP + generated strong password, or IAP), bind it. Works everywhere, zero networking assumptions.

Fold this choice into the single plan confirmation — when an existing Grafana is viable, the plan presents both options with your recommendation, and the user's reply decides.

Then:

- **Grafana exists already**: ask the user to add Loki as a datasource if missing (or do it via their Grafana API if you have access), then guide them through Nuphos's bind dialog — the service-account token stays in their custody.
- **No Grafana**: deploy one next to Loki (a k8s Deployment + Service, or docker on the VM), then:
  1. add the Loki datasource via `POST /api/datasources` (`{"name":"loki","type":"loki","url":"http://<loki>:3100","access":"proxy"}`),
  2. create a service account (Viewer is enough for querying) + token via `POST /api/serviceaccounts` and `POST /api/serviceaccounts/<id>/tokens`,
  3. bind it yourself: `POST {NUPHOS_BACKEND_URL}/teams/$TEAM/grafana-instances` with `{"name":"<label>","grafanaUrl":"https://<reachable-url>","saToken":"<token>"}` using the caller's Nuphos token (requires team ADMINISTRATOR — confirm with the user before binding). Never print the saToken into chat.
- **Reachability**: the bound `grafanaUrl` must be reachable by the Nuphos backend (the bind API rejects private/blocked hosts). Options, in order of preference: an ALREADY-EXISTING ingress/HTTPS load balancer on the host (reuse its domain + TLS rather than opening a raw NodePort/port with plaintext HTTP); a new HTTPS LB with strong auth; or a provider private-access option (e.g. **GCP IAP**, authorizing the Nuphos connector identity) for private-only requirements. When Grafana sits next to Loki, Loki itself needs no exposure at all; only the remote-Grafana path above exposes Loki's query API (auth'd, query-only).

### 3. Install the collector on each VM

On a VM the collector is a HOST-level systemd service — even when the VM runs k3s/docker. This is deliberate, not a shortcut: container runtimes land container logs on the host filesystem anyway (`/var/log/containers`, docker json-files), so one host Alloy covers journald + host files + containers; and a collector living inside the cluster dies with the cluster, losing exactly the logs that explain the failure. Do NOT hand-roll an in-cluster DaemonSet for a single VM — the DaemonSet form is for real multi-node clusters (3b).

Use the bundled installer — it is idempotent, distro-aware (apt and dnf/yum), provider-agnostic, and pins the label convention:

```bash
# SSH-style channel (gcloud shown; plain `ssh user@host` works identically)
for vm in <confirmed instances>; do
  gcloud compute ssh "$vm" --zone <zone> --command \
    "sudo LOKI_URL=http://<loki>:3100 ENV_LABEL=stage SERVICE_LABEL=<service> bash -s" \
    < skills/loki/scripts/install-alloy.sh
done

# RunCommand-style channel (Tencent TAT / Aliyun Cloud Assistant / Volcengine ECS Assistant):
# no stdin — prepend the env exports to the script and send it base64-embedded, e.g.
#   { echo "export LOKI_URL=… ENV_LABEL=… SERVICE_LABEL=…"; cat skills/loki/scripts/install-alloy.sh; } | base64
# then pass that as the command content and poll the invocation result.
```

- The script installs **Grafana Alloy** (Promtail is EOL — do not install it), ships systemd-journal + `/var/log/*.log`, and accepts `EXTRA_LOG_PATHS="/opt/app/logs/*.log"` for app-specific files (ask the user where their apps log).
- Alloy idles at a few tens of MB RSS — far below any sane VM budget.
- **Instance groups / auto-scaling groups** (GCP MIG, Tencent AS, Aliyun ESS, Volcengine scaling groups): VMs onboarded one-by-one will rot as the group scales. Embed the same installer (with the env values rendered in) into the group's launch template `user-data` / `startup-script` and roll it out — new instances then self-onboard. Confirm before touching templates.

### 3b. Cluster targets (Kubernetes)

When the target is a k8s cluster rather than a VM, do NOT SSH its nodes. Deploy Alloy as a **DaemonSet** via the `kubectl` skill (the `grafana/alloy` Helm chart is fine when helm is available): hostPath-mount `/var/log/pods` + `/var/log/containers`, forward to the Loki URL, and keep the same external labels — `instance` = the node name (via the downward API), `service` from what the cluster runs. This covers GKE/TKE/ACK/VKE/k3s identically. When Loki lives in the same cluster, push over ClusterIP; from another cluster, push over a VPC-internal route (security-group rule, after confirming).

### 3.5 Confirmation model

The single plan-confirmation from the UX contract covers every step it lists (installs over SSH/RunCommand, deployments, one firewall/security-group rule, the Nuphos bind). Re-ask ONLY when reality diverges from the plan — e.g. the port is taken, the VM has no k8s after all, or you need to touch something the plan didn't mention.

### 4. Verify end-to-end (always do this)

The installer emits a marker line via `logger` (tag `nuphos-onboarding`). Prove retrieval works by querying it back through the bound Grafana proxy (see Query patterns below) with `{instance="<vm>"} |= "loki onboarding marker"` over the last 15 minutes, and show the user the returned line. Onboarding is not "done" until this query succeeds.

## Query patterns (time range + keyword)

Mechanics live in the `grafana` skill (`ac` helper, `POST /api/ds/query`, datasource type `loki`). The idioms for log retrieval:

```bash
# Keyword on one VM in a time window (epoch ms in from/to)
{"expr": "{instance=\"c-engine-3\"} |= \"timeout\"", "queryType": "range", "maxLines": 200}

# One service across the fleet, errors only
{"expr": "{service=\"c-engine\", env=\"stage\"} |~ \"(?i)error|panic|fatal\"", "queryType": "range", "maxLines": 200}

# How often is it happening (spike hunting)
{"expr": "sum(count_over_time({service=\"c-engine\"} |= \"timeout\" [5m]))", "queryType": "range"}
```

- Always set `from`/`to` to the user's actual window — never query unbounded.
- Start with `maxLines` ≤ 200 and narrow with more `|=`/`|~` filters instead of raising it.
- Use the fixed labels for scoping; only fall back to `{job="systemd-journal"}` when the target VM/service is unknown.

## Wiring alerts to auto-investigation

Once logs flow, alert rules on the Loki datasource (or Loki ruler) can feed the trigger pipeline: create a Grafana alert rule on a LogQL expression, then follow the `grafana` skill's "Wiring a Grafana alert to a Nuphos trigger" recipe — a firing alert then starts an agent session that queries the relevant time window and summarizes.

## Safety

- Confirm before every mutating step: commands executed on customer machines (SSH or RunCommand), deployments, firewall/security-group rules, template changes, and the Nuphos bind call.
- Everything deploys into the customer's project; never route log data through Nuphos.
- Never print Grafana SA tokens or admin passwords into chat; pass them directly between APIs.
- The installer is idempotent — re-running on an already-onboarded VM is safe and is the standard repair action.
