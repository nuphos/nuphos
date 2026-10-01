# Nuphos Desktop — project rules

## Components

- **Always prefer Base UI (`@base-ui/react`) components.** Before building any
  UI element, check whether Base UI provides it.
- If Base UI does not have it, try to compose it from existing components in
  this repo (e.g. `src/components/ui/*`).
- Only if that is also impossible, **ask** whether a new component should be
  created. Do **not** proactively invent new components.

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
