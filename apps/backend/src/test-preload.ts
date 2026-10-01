// Global bun-test preload (bunfig.toml [test].preload) — runs before ANY test
// file or module is loaded, so env-derived singletons like @/config freeze
// with these values regardless of which test file happens to import them
// first. Per-file `*.test-env.ts` imports are too late for a full-suite run:
// another test file can pull in @/config before that file's first line
// executes, and the singleton then misses the env (this exact ordering broke
// the journal HMAC-fingerprint test in CI while passing in isolation).
//
// `??=` keeps any value provided by the real environment (e.g. CI secrets).
//
// ATLAS_SKILLS_* intentionally omitted here — enabling the store globally makes
// resolveSkillsDirectory sync S3 on every test import and races on the shared
// cache dir in CI. Skills E2E mocks skills-s3 and opts in locally.
// Memory feature flags are pinned to their DEFAULTS (deleted, not ??=): tests
// assert default-off behavior, and a developer's .env legitimately flips these
// for live runs (e.g. the Slack canary sets MEMORY_AUTO_INGEST=true) — ambient
// dev config must never change what the suite asserts. Flag-on paths opt in
// via the config-facade mock (agentOverrides), never via real env.
delete process.env.MEMORY_ATTRIBUTION_JUDGE
delete process.env.MEMORY_AUTO_INGEST
delete process.env.MEMORY_DELIVERY_MODE
delete process.env.MEMORY_RERANK_ENABLED
delete process.env.MEMORY_INDEX_RANKING
delete process.env.MEMORY_PROVIDER
process.env.MONGODB_URI ??= 'mongodb://unit-test:27017'
process.env.JOURNAL_HMAC_KEY ??= 'unit-test-journal-hmac-key'
// Signs/verifies MCP + Marketplace tokens via config.auth.jwtSecret. Must be
// set here (not in a per-file beforeAll) because config freezes on first import
// — see oauth/aws-marketplace tests, which round-trip against this value.
process.env.NUPHOS_JWT_SECRET ??= 'unit-test-jwt-secret' // On-prem relay. Same reason as the JWT secret: the enrolment route bakes these
// into the install manifest it returns, and config freezes on first import, so a
// per-file assignment would be too late in a full-suite run.
process.env.NUPHOS_RELAY_TOKEN_SECRET ??= 'unit-test-relay-token-secret-32b!!'
process.env.NUPHOS_RELAY_AGENT_ENDPOINT ??= 'relay.unit-test.invalid:8444'
process.env.NUPHOS_RELAY_PROXY_ENDPOINT ??= 'relay.unit-test.invalid:8443'
// Digest-shaped: the enrolment route refuses to render a manifest without an
// image, and a mutable tag here would make the tests disagree with the rule.
process.env.NUPHOS_RELAY_AGENT_IMAGE ??=
  'public.ecr.aws/unit-test/kube-relay-agent@sha256:0000000000000000000000000000000000000000000000000000000000000000'
// Registering a self-hosted runtime refuses to hand it an address it cannot
// reach, so the suite needs a public base for the same reason as the JWT
// secret: config freezes on first import.
process.env.NUPHOS_PUBLIC_BACKEND_URL ??= 'https://unit-test.invalid'
