---
name: architecture-diagram
description: Design conventions and an API-based workflow for building clear system architecture diagrams on the user's Nuphos canvas. Use whenever asked to draw, build, map, or restructure an architecture, system, or infrastructure diagram.
---

# Designing a good architecture diagram

You edit the open diagram through the canonical Nuphos REST API. Never reply
with Mermaid / DOT / ASCII — the canvas is the only output surface. GET the
diagram first, modify its `nodes` and `views`, and PUT each coherent increment
back so the canvas updates while you work. **Do NOT create a plan** for diagram
work.

## API workflow

Use the bundled script; it builds the team URL, supplies the conversation
token, accepts inline JSON or `@file`, and fails on non-2xx responses:

```bash
SCRIPT=skills/architecture-diagram/scripts/diagram-api.sh
bash "$SCRIPT" "$TEAM" GET "$DIAGRAM" > /tmp/diagram.json
bash "$SCRIPT" "$TEAM" PUT "$DIAGRAM" @/tmp/diagram-update.json
```

| Action | Call |
|---|---|
| List | `GET /teams/{teamId}/architecture-diagrams` |
| Create | `POST …/architecture-diagrams` with `{ "name": string }` |
| Read | `GET …/architecture-diagrams/{diagramId}` |
| Update | `PUT …/{diagramId}` with any of `{ name, nodes, views }` |
| Delete | `DELETE …/{diagramId}`; only when explicitly requested |

An update replaces the supplied `nodes` or `views` array, so always derive it
from the latest GET. Preserve unknown fields and untouched views. Generate
stable unique string ids locally. Do not call `arch_*` bound tools; this API is
the single contract shared with Desktop.

What separates a clear diagram from a tangled one is not the tool — it's these decisions. And a diagram is only as good as what you actually discovered: don't stop at one provider.

## 0. Find the WHOLE system — follow threads across providers

The biggest failure is a thin, single-provider snapshot: you explore the cluster and stop, missing that the same system spans Cloudflare, GitHub, etc. Every touchpoint that leaves one provider's boundary is a **thread into another connected system — follow it**:

- **A public domain → its DNS provider.** A domain on an ingress/load balancer is managed somewhere. Check the DNS provider (Cloudflare, Route53, …) and add the **zone** as a node with an edge. (e.g. `api.nuphos.ai` → a Cloudflare zone managing its DNS.)
- **A container image / registry → what builds & pushes it.** An ECR/GCR/Artifact-Registry repo is fed by CI. Go to the source repo (GitHub/GitLab), find the workflow that builds and pushes, and add the **repo + CI pipeline** with a "pushes image" edge. (e.g. ECR ← GitHub Actions in the repo.)
- **A running service → its source repo and what deploys it** (Actions, Argo, Flux).
- **Secrets / config / connection strings → where they originate.**

Method: (1) note which integrations the team has connected — AWS, GCP, Cloudflare, GitHub, GitLab, Tailscale, … (2) build the core from the primary system; (3) for **every edge that crosses a provider boundary**, open the OTHER provider with its skill (`cloudflare`, `github`, `gitlab`, `aws`, `gcloud`, …) and find the counterpart, then add it; (4) stop when threads stop crossing boundaries. If a provider isn't connected, still represent the external dependency as an `abstract` node so the relationship is visible.

This is what makes it a cross-provider **system map**, not a single-cloud snapshot.

## 1. Group related things together (the core idea)

An architecture diagram is **not layered by abstract category**. It's organised by **relatedness and locality**: components that work together sit next to each other. cert-manager belongs **beside** ingress (it issues ingress's TLS), not in a separate "platform" row far away. The load balancer sits right above the ingress it feeds. The observability tools cluster together. A database sits **next to the service that uses it**.

The test: **two nodes connected by an edge should be near each other.** If you find related things ending up far apart, you've grouped wrong. Short edges = readable diagram.

Do NOT segregate nodes into horizontal bands by type ("all infra here, all data there"). That pulls related things apart and is the #1 way diagrams turn into spaghetti.

## 2. Use groups for real boundaries

When several nodes live inside the same boundary — a Kubernetes cluster, a VPC, a namespace, a cloud account — draw that boundary as a **group**: a labelled rectangle.

1. Decide the rectangle: a top-left `(x, y)` and a `width`/`height` big enough to comfortably enclose the members (each member is 200×72; leave ~40px padding and room for the header).
2. Add a node with `size: { width, height }`; a `size` makes it a group.
3. Put members "inside" simply by giving them positions **within that rectangle**. There is NO parent field — membership is purely geometric (a node is in the group when it sits inside the group's rect). Nesting (a group inside a group) works the same way: just place the smaller group's rect inside the bigger one.

Create the group rectangle first, then place its members inside it. If members don't fit, grow the group's `size` — the group never auto-resizes.

## 3. Lay out by proximity, then alignment

All positions are **absolute** (top-left). Place each node **near the nodes it connects to** — that's the whole game. The tools AUTOMATICALLY keep regular nodes from overlapping each other (your x/y is the hint they nudge from); groups are passive rectangles you size yourself and may freely enclose nodes. Place deliberately by relatedness; don't fight the nudge. Then tidy:

- Nodes are a **fixed 200×72**, positioned by their **top-left corner**. So two nodes with the **same `x` are centre-aligned** → an edge straight down between them is vertical. Use the same `x` for a node and the thing directly above/below it to get a straight edge.
- Lay a loose grid: snap nodes to x values ~**230 apart** and y values ~**130 apart**, but bend the grid to keep related nodes adjacent — proximity wins over perfect rows.
- A flow that's a straight chain (A → B → C) should be a straight column.
- Nodes meant to be inside a group just need absolute positions that fall within that group's rectangle (remember the header eats the top ~40px).

## 4. Colour by kind

Set `kind` on every node so it's colour-coded: `cloud` (infra/cloud resources, teal), `code` (repos, CI/CD, purple), `abstract` (users, external systems, boundaries, grey).

**Exception: any node with a `url` derives its kind from that link automatically** (repos/CI → code, plans/sessions → abstract, all infra → cloud). So for a linked node you don't need to set `kind` — just set a good `url` (see §5) and the colour follows. Still set `kind` explicitly on url-less nodes (users, external systems, abstract boundaries).

## 5. Concrete vs abstract nodes — bind real things with a `url`

Every node is one of two kinds:

- **Concrete** — it maps to a real resource/page, so set its **`url`**. There is NO separate "resource tag" (no provider/type/id); the url *is* the binding. Use the app's own page URL — the same path you'd land on by browsing to the resource in the UI — so a double-click navigates **in-app**:

  `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/clusters/<region>/<cluster>/workloads/deployments/namespaces/<ns>/resources/deployment/<name>`

  Don't guess the path. Build it from the **same GUI route catalog** you use for markdown links: `rg -i "<resource keyword>" skills/nuphos-api/references/gui-routes.md` (e.g. `pod|deployment|service`, `s3|bucket`, `ec2|instance`) gives the URL template and the ids it needs. A non-`nuphos.ai` URL still works — it just opens in the external browser — but prefer the in-app page URL whenever the resource has one.

- **Abstract** — a logical box with no real counterpart (a user, an external/third-party system, a conceptual boundary). Leave `url` unset and give it a sensible `kind` for colour.

Default to making a node concrete whenever it represents something you actually discovered. The more nodes carry real in-app `url`s, the more the diagram becomes a navigable map rather than a static picture.

## 6. Edges: real, directional, sparse, lightly labelled

- Direction means something: `source → target` = "calls / depends on / reads / deploys to".
- **Don't over-connect.** Show the meaningful relationships, not every possible one. Too many edges from one node (e.g. ingress → every service, each labelled with a domain) collapses into overlapping clutter — that's a sign to drop or merge edges.
- **Avoid parallel-edge bundles.** Many edges running side-by-side over a long distance stack into one unreadable thick line. If a node connects to several others (e.g. Grafana → VictoriaMetrics, Loki, Tempo), place those targets **close together right next to the hub** so the edges are short and fan out — never run them as a long parallel corridor across the diagram.
- **Never repeat the same label on parallel edges.** Three edges all labelled "queries" just overlap into noise. Label the relationship once (or leave it off) when several edges mean the same thing. Same for the domain labels — don't tag every ingress edge with a hostname.
- Label only when the label adds information (`reads`, `image pull`); leave obvious edges unlabelled.

## 7. One view per story

Don't cram traffic + deploy + structure into one view. Add alternate entries to
`views` over the **same** nodes — `Structure`, `Traffic`, `Deploy` — each with
its own edges/colours.

## Build order

1. GET the open diagram to see current state.
2. Identify the **groups** (clusters/VPCs/namespaces/accounts) and which components relate to which.
3. PUT each group rectangle first, then add members at positions inside it (`kind` + `position`), placing each near its neighbours.
4. PUT the updated view with sparse, directional, lightly-labelled edges.
5. Optionally add extra views for other stories.

## Anti-patterns (avoid)

- **Layering by category** (a row of "platform" things, a row of "data" things) → pulls related nodes apart. Group by relatedness instead.
- **Over-connecting / over-labelling** → overlapping edges and labels.
- One giant view holding every relationship → split into views.
- Flat diagram with no containers when there's an obvious cluster/VPC.
- Three nodes for a 3-replica Deployment → use **one** node labelled `×3`.
