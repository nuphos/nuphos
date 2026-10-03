# Repository Instructions

## Pull Requests

- Open PRs as ready for review by default. Use draft PRs only when the change is genuinely still a work in progress or the user explicitly asks for a draft.
- PR titles must follow Semantic Commit Messages, for example `fix(agent): improve Braintrust chat traces`. Do not prefix PR titles with `[codex]`.

## Releases

- Before planning, preparing, or executing a release of any component — Backend, Desktop or iOS — read and follow `.claude/skills/release-nuphos/SKILL.md`. The runtime image lives in `apps/runtime` and has independent `runtime-vX.Y.Z` tags; see `apps/runtime/README.md` for its gated release workflow.
- Never automatically create a Major version. Automated releases may only produce Patch or Minor versions; Major releases require an explicit manual `X.0.0` baseline.

## Apps

### `apps/desktop`

- When the user says "local dev", they mean Electron local dev. Use `pnpm electron:dev` rather than the web-only Vite dev server unless they explicitly ask for web dev.

#### Page headers & the shared Toolbar

Workspace pages get **one** header: the shared `Toolbar` row (breadcrumb row + a controls row with the search box, filter/action slots, and refresh). Do **not** hand-roll a per-view header band, and do not add new `PageHeader` usages for workspace list pages — the breadcrumb already carries the page title, so a `PageHeader` title just duplicates it and rebuilds the stacked band this effort removed. `components/PageHeader.tsx` is legacy; it survives only for the Settings overlay (below) and Group-B detail panes.

To publish controls from a view into the Toolbar:

- **One primary CTA** → `useToolbarPrimaryAction(label | null, onClick, disabled?)`. Renders a `+`-prefixed violet button; pass `null` to publish nothing.
- **Filters / tabs / pickers / extra buttons** → `useToolbarSlot('left' | 'right', active)` + `createPortal` into the returned mount (`left` sits by the search box, `right` is the actions region). A non-`+` action (e.g. a gear, or Export) belongs in a slot, not the primary-action hook.
- **Always gate publishing on `useWorkspaceTab().isActive`** — keep-alive keeps inactive tabs mounted, and an ungated publisher lets a background tab clobber the active page's controls. Also drop the slot in states that render no list (error/disabled) so the controls row never lingers empty.
- **Reuse, don't rebuild:** in-view search fallbacks use the exported `SearchBox` from `components/Toolbar.tsx`; don't roll a bespoke input.

**Dual-host views** (rendered both in the workspace shell _and_ the Settings overlay, e.g. `TeamMembersView`, `AuditLogView`): the Settings overlay hides the main shell, so there is no Toolbar there. Detect the host with the `filter` prop — the workspace passes a `filter` string, Settings passes none (`filter === undefined`) — and in Settings render an in-view fallback that **mirrors the Toolbar's two rows**: a titled header (`PageHeader`) then a controls row (search + filters left, CTA right). Never gate the Settings fallback on `isActive` (that also fires for inactive workspace tabs).

**Group B — keep bespoke:** detail-pane headers that identify a specific opened resource and carry back/close navigation the breadcrumb does not replicate (k8s `DetailView`, Grafana log/trace explorers, the GCP dashboard detail, `ConnectorInfoView`, `MongoSchemaExplorer`, CloudWatch log-stream, and slide-in detail sidebars) are **not** part of this convention — leave them as they are.
