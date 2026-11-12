# Nuphos Desktop — project rules

## Components

- **Always prefer Base UI (`@base-ui/react`) components.** Before building any
  UI element, check whether Base UI provides it.
- If Base UI does not have it, try to compose it from existing components in
  this repo (e.g. `src/components/ui/*`).
- Only if that is also impossible, **ask** whether a new component should be
  created. Do **not** proactively invent new components.
- Never restyle a native control in a view: dropdowns use `AppSelect`, toggles
  `Switch`, filled actions `Button`, dialogs `Modal`. `primitiveGuard.test.ts`
  fails CI on a raw `<select>`, `role="switch"` or filled rounded `<button>`.

## Icons

- Pick whichever icon library best fits the context — use your own judgement.
  Font Awesome (`@fortawesome/react-fontawesome`) and `lucide-react` are both
  available.
- **Exception:** the settings nav reuses the app sidebar's `SidebarNavItem` / `SidebarNavIcon` (lucide).

## Error handling / UI feedback

- Surface user-facing errors through the global **toast**, never as inline UI
  (no error box under a button, no inline error text). The helpers live in
  `src/components/ui/toast.ts`.
- **Caught errors go through `toast.apiError(title, err)`** — pass the raw
  caught value, never a pre-formatted message. Error toasts are whitelist-only:
  only backend-authored business errors (structured `{code, message}` via the
  atlas sentinel) are shown; network/transport/unexpected errors are suppressed
  and reported to PostHog instead. Never build the description yourself with
  `parseAtlasError(e).message` / `e.message` — that bypasses the whitelist.
- `toast.error(title, description?)` is only for **hand-authored** messages
  (validation feedback, local failures with a message you wrote yourself).
  `src/lib/toastErrorGuard.test.ts` fails CI if a `toast.error` description is
  built from a caught error.
- The `<ToastProvider>` is mounted once at the app root in `src/main.tsx`. The
  toast manager is global, so non-component code (e.g. API catch blocks) can
  call `toast.apiError(...)` too.

## Data fetching

The team members and roster reads are a TanStack Query pilot (#2181). The rest
of the renderer still loads data as before.

- The client and its defaults live in `src/lib/query/client.ts`: a read is
  retried once, and only when it got no answer; writes are never retried; a
  hidden window does not poll, and focus refreshes what went stale.
- Keys come from `queryKeys` in `src/lib/query/keys.ts` and start with their
  scope (`['team', teamId, ...]`), so one `invalidateQueries` refreshes it all.
- `src/lib/query/team.ts` holds the pilot's helpers: `teamMembersQuery`,
  `teamRosterQuery`, and `teamMembersReadNow` for a view that decides something
  once from the members and so must not start from a cached answer.
- Read members through `useTeamMemberList` / `useTeamMembers`, or
  `queryClient.query(teamMembersQuery(teamId))` outside a component.
