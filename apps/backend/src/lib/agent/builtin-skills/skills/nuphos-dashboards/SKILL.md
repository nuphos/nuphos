---
name: nuphos-dashboards
description: Build and update a Nuphos Dashboard (the Dashboards page; not Grafana) — a blank canvas of panels, each backed by a JavaScript script that re-runs on one of the team's agent runtimes, pulls any Nuphos API or connected-provider data, and emits a chart, number, or table. Use it for cloud spend, AI usage, infrastructure inventory, reliability, or any other metric the team wants charted.
---

# Nuphos Dashboards

A Nuphos Dashboard is a **Grafana-style blank canvas**, but it is not Grafana: its panels are scripts, not Grafana queries, and it lives on the Dashboards page. Cloud spend is one common use; a panel can chart any data a script can read through the Nuphos API or a selected connected account. A dashboard has **no privileged "total" header** — every number, including total spend, is just a panel. Each panel's data source is a stored JavaScript script that runs when the panel is created or explicitly refreshed, producing an immutable **snapshot**. A separate AI pass turns the first snapshot into an **Insight**; each panel can have its own **Alert**.

Given a supported read-only data source, build a useful dashboard (or add/adjust panels) by writing panel scripts against the contract below and calling the dashboard API. Never invent an endpoint or substitute sample data when the source does not expose the requested data.

## Viewing time ranges

The toolbar time range is a per-tab view option, persisted in the URL. Changing it
must not PUT the shared dashboard definition. GET detail, POST refresh, panel
execute, and insight routes accept `preset=last7|last14|last30|thisMonth|prevMonth`
or `periodStart` + `periodEnd` (ISO timestamps), with optional `granularity`.
GET returns `viewTimeRange` alongside the unchanged saved dashboard definition.
Snapshots are reused only for matching script and resolved params; view queries
do not evaluate shared alerts. Scheduled runs keep using the saved default range.

## The panel script contract

A panel script runs as an ES module on one of the team's agent runtimes (any online runtime; not the conversation's workspace, so it cannot read local files). It receives three globals and must emit exactly one payload.

Globals available to every script:

- `params` — the resolved run params: `{ periodStart, periodEnd, granularity, ...staticParams }`. `periodStart`/`periodEnd` are ISO strings and **come from the requested view range, or the dashboard's saved default for scheduled runs** (a panel never sets its own window). `granularity` is `"day" | "week" | "month"`. Anything you put in a panel's `staticParams` (e.g. `provider`, `accountId`, filters) is merged in here.
- `nuphos` — a read-only HTTP client authenticated with a short-lived panel token for the current script's author: `nuphos.get(path)`. It only calls the Nuphos backend, and the token only allows GET requests for the credentials selected in the panel's settings, connector metadata, `/usage`, and dashboards.
- `emit(payload)` — record the panel output. Last call wins. Alternatively `export default` the payload (or a function returning it).

The payload MUST be one of these three shapes (`kind` is the discriminator, and must match the panel's declared `kind`):

```ts
// kind: 'chart'  — ChartPayload-shaped; renders with Recharts.
{ kind: 'chart', type: 'area' | 'bar' | 'line', title: string, description?: string,
  xKey: string, series: [{ key: string, label?: string }, ...],
  data: [ { [xKey]: string|number, [seriesKey]: number|null }, ... ], stacked?: boolean }
// Rule: EVERY data row must contain xKey and, for each series key, a number or null
// (never undefined/string — the renderer treats a missing series value as an error).
// Multi-series scale: only put multiple series on ONE chart when they share a
// scale AND compose a whole — then set stacked:true (e.g. daily spend split by
// account/service reads as total + parts). Do NOT overlay independent series of
// different magnitudes on one axis; give each its own panel instead.

// kind: 'scalar'  — one big number (this is how "total spend" is a panel).
{ kind: 'scalar', title: string, value: number,
  unit: 'usd' | 'count' | 'percent', deltaPct?: number, sublabel?: string }

// kind: 'table'  — ranked rows.
{ kind: 'table', title: string,
  columns: [{ key: string, label?: string, numeric?: boolean }, ...],
  rows: [ { [colKey]: string|number|null }, ... ] }
```

Limits: ≤12 series, ≤1000 rows, output ≤512 KB, script wall-clock ≤5 min. Print nothing else to stdout that matters — only the emitted payload is read.

### Supported example: Nuphos AI usage

The implemented `GET /teams/{teamId}/usage` endpoint returns roughly
the last 31 days of AI usage as
`{ days: [{ date, members: [{ costUsd, totalTokens }] }] }`. A daily spend panel
can filter that response to the dashboard range:

```js
const usage = await nuphos.get(`/teams/${params.teamId}/usage`);
const start = params.periodStart.slice(0, 10);
const end = params.periodEnd.slice(0, 10);
const data = usage.days
  .filter((day) => day.date >= start && day.date <= end)
  .map((day) => ({
    date: day.date,
    usd: day.members.reduce((sum, member) => sum + member.costUsd, 0),
  }));

emit({
  kind: 'chart',
  type: 'area',
  title: 'Nuphos AI spend',
  xKey: 'date',
  series: [{ key: 'usd', label: 'USD' }],
  data,
});
```

## Fetching connected-account data inside a panel

Prefer an implemented Nuphos **read endpoint** when it already returns the data
the panel needs. Build Nuphos paths with `params.teamId`; never hard-code a team
id.

When Nuphos has no suitable read endpoint, the panel may use `nuphos.get(...)`
to retrieve the selected connected account's team-scoped `/credentials`, then
call the provider API directly with `fetch`. A panel can vend only the
credentials selected in its settings (`credentialAccess` on the panel; absent
means the same default a new conversation gets). A 403 from a `/credentials`
route means that account is not selected for the panel — ask the user to
select it in the panel's settings rather than working around it. Keep every provider operation
read-only (GET/list/describe), and never emit, print, or otherwise include a
credential in panel output. Do not invoke provider mutation endpoints or
substitute sample data for unavailable billing data.

## Dashboard API: call these exact endpoints

All routes are team-scoped under `/teams/{teamId}/dashboards`. Bodies are validated; use the exact field names below — do not probe routes or guess. Panel writes require EDITOR/ADMIN.

**This table is authoritative — do NOT discover the API.** Do not run `nuphos-api`'s `scripts/openapi.sh`, fetch `/openapi.json`, or read `/tmp/nuphos-openapi.json` for dashboards: that document is large and slow to pull, and these v2 routes may not be listed in it yet. Discovery here only wastes a turn. Call the endpoints directly with the user's token already exported in your environment:

```bash
SCRIPT=skills/nuphos-dashboards/scripts/dashboards-api.sh
bash "$SCRIPT" "$TEAM" GET
bash "$SCRIPT" "$TEAM" POST '' @/tmp/dashboard.json
bash "$SCRIPT" "$TEAM" POST "$DASH/panels" @/tmp/panel.json
bash "$SCRIPT" "$TEAM" GET "$DASH"
```

The script builds the canonical team URL, authenticates with `NUPHOS_TOKEN`,
accepts either inline JSON or `@file`, prints formatted JSON, and turns non-2xx
responses into a failing command. Put scripts and large bodies in files rather
than shell-escaping them inline. Do not call a bound `cost_dashboard_*` tool;
the REST response is the single contract used by both Desktop and the agent.

| Action | Call |
|---|---|
| Create dashboard | `POST /teams/{teamId}/dashboards` → `{ name, timeRange: { periodStart, periodEnd, granularity? } }` |
| Add a panel (auto-runs + eager insight) | `POST …/{dashboardId}/panels` → `{ title, kind: 'chart'\|'scalar'\|'table', code, staticParams?, credentialAccess? }` |
| Edit a panel (code edit ⇒ new version) | `PUT …/{dashboardId}/panels/{panelId}` → `{ title?, kind?, code?, staticParams?, credentialAccess? }` |
| Re-run one panel | `POST …/{dashboardId}/panels/{panelId}/execute?force=1` |
| Re-run all panels | `POST …/{dashboardId}/refresh?force=1` |
| Schedule refreshes | `PUT …/{dashboardId}` → `{ cadence: 'daily'\|'weekly'\|'monthly'\|null }` |
| Read dashboard + panels + snapshots | `GET …/{dashboardId}` |
| Regenerate a panel's insight | `POST …/{dashboardId}/panels/{panelId}/insight` |

Key facts:

- `timeRange` is the single source of truth for time; **every panel inherits it**. Panels carry only `staticParams` (provider, accountId, filters) — never their own start/end.
- Editing a panel's `code` creates a **new script version**; existing snapshots keep the version they ran against (immutable). Re-running produces a new snapshot.
- A schedule belongs to the whole dashboard and refreshes every panel at 09:00 UTC: daily, on Mondays (weekly) or on the 1st (monthly). Tell the user that time in both UTC and their own timezone.
- Adding a panel runs it immediately and generates its first Insight eagerly. Later refreshes update data only; the prior Insight becomes stale until the user explicitly regenerates it.

## Building the initial dashboard

Use the API script for the whole build path: list dashboards first, create or
reuse one, create each panel, then GET the dashboard to inspect the actual
current and last-successful snapshot outputs.

For a first "build me a dashboard" request, create **four** complementary panels that answer the user’s decision: a headline number, a time trend, the largest drivers, and one provider-specific optimization or risk view. Add more only when the request names an additional question. Pick each visual from the data shape (time series → area/line; share or rankings → bar/table) and don't stack identical charts. Use real provider evidence; never fill a visual with guessed zeroes.

### One-shot completion

1. Reuse an existing dashboard only when it clearly matches the requested account and decision; otherwise create one.
2. Create the full initial panel set before reporting. Then GET the dashboard: report completed panels from their snapshot output, name a failed panel with its `error.kind`, and state that running snapshots continue in the dashboard. Do not claim that a running panel has data.
3. Do not create recurring Slack reports by default. Insights already belong to each panel. When the user explicitly requests Slack, prefer a threshold alert on a scalar panel; it is edge-triggered and concise. A daily report must be at most five lines: time window, total/change, up to two drivers, and one next action — no raw JSON, scripts, command logs, or repeated setup instructions.

## Guardrails

These apply to every panel you create or edit, not just the initial build.

1. For spend panels, prefer the provider's native billing/usage export and mark data `actual`. Otherwise compute from official provider pricing and label it `estimated` with assumptions — never turn missing usage into zero cost. For any metric, never turn missing data into zero.
2. A panel script must be deterministic given `params` and must not mutate infrastructure — it only reads and shapes data.
3. Insights bind to a snapshot as evidence; every Insight **action** is a safe handoff prompt that asks Nuphos to investigate and produce a **Plan** for user confirmation before any change. Never make changes during analysis.
4. If a panel run fails, read the snapshot's `error.kind` (`timeout` / `oversize` / `nonzero_exit` / `invalid_output`) and fix the script — usually an off-contract payload (a row missing `xKey`, a string where a number is required) or an unhandled `nuphos` response. `runtime_unavailable` (no runtime online, or it was busy/unreachable) and `runtime_outdated` (the runtime image cannot run panels) are not script bugs: report the snapshot's `error.message` to the user instead of editing the script.
