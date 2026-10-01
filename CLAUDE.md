# Project Instructions

Root-level conventions for this repo. General PR conventions also live in `AGENTS.md`.

## Environment variables

The backend config module is the single source of truth for backend env vars: `apps/backend/src/config.ts` composes the section files under `apps/backend/src/config/` (`core`, `agent`, `byos-*`, `storage`, …), which is where each var is actually read and documented. It is one surface, split only so no file exceeds the `max-lines` limit. Every PR must uphold the following:

- **Audit each PR for env-var changes.** Before opening a PR, check whether it introduces, removes, or renames any environment variable.
- **Keep `.env.example` in sync.** If the set of env vars changed, apply the matching add/remove/rename in `apps/backend/.env.example` in the same PR, with the usual explanatory comment and a sensible default/placeholder. The one exception: runtime/platform-injected vars (`HOSTNAME`, `TMPDIR`, `POD_NAMESPACE`, `NODE_NAME`, `GIT_SHA`, `ATLAS_BACKEND_VERSION`, `TERMINATION_GRACE_SECONDS`) are read but never hand-set, so they live in the guard test's allowlist rather than `.env.example`.
- **Never bypass the config module.** All backend env access goes through it (via the `required()` / `optional()` / `bool()` / etc. helpers in `src/config/env.ts`). No production source file outside `src/config.ts` and `src/config/` may read `process.env` or `Bun.env` directly. A new var belongs in the section that owns its feature — not in a new file elsewhere. Exceptions: `src/test-preload.ts` (seeds env before config's singleton freezes) and test files (they legitimately set env fixtures) — the rule targets shipped production code.
- **Guard it with a unit test.** A test must fail CI when:
  - the key sets in `apps/backend/.env.example` and the config module drift apart, and
  - any production source file outside the config module reads `process.env` / `Bun.env` directly.
