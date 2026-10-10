# MongoDB agent traces

The backend records new agent traces in MongoDB, with independent OpenTelemetry
instrumentation. The Braintrust SDK, exporter, configuration and backfill script
have been removed. No new trace data is sent to Braintrust. Historical vendor
data is not imported or deleted.

## Enablement and privacy

New agent traces write directly to the existing MongoDB connection. No local
storage, per-replica volume or separate enablement setting is required.

Payloads may contain prompts, tool output, credentials printed by tools and error
stacks. There is deliberately no new redaction or truncation: that would violate
the full-content migration contract. Apply the same access, encryption and backup
controls as conversation data to MongoDB. No public read endpoint is introduced. Future readers must
check per-session access, not merely team membership.

## Coverage

- Explicit span start, input, output, metadata, metrics, errors (including stack
  and cause), named events, end, and conversation-root updates.
- The three current `wrapAI` callers (title generation, starter suggestions,
  dashboard insights): generation options, resolved output format, every
  provider `doGenerate` attempt (including failed attempts), and the final AI
  SDK result including getter-backed text, reasoning, steps, tools, token
  usage, response ids and provider metadata.
- Existing caller-side message serialization is unchanged;
  the Mongo sink adds no preview limit. Provider transport bodies and response
  headers are excluded, preserving the previous capture contract.

Native `generateText` instrumentation covers current callers; adding another
SDK function to `wrapAI` requires equivalent instrumentation and parity tests.
New spans export self-contained `mongo:` parent handles. Conversation roots use
`conversationTraceParent`; legacy vendor parent fields are left untouched in old
Mongo documents but are not read or reused. Unrecognized parent handles are ignored; there is no vendor decoder. Ownership metadata
survives with OTel disabled.

## Storage and retention

`agent_trace_events` is append-only. Filter by `sessionId`/`teamId`, `rootSpanId`
or `spanId`; order one span's events by `ts`, then `sequence`. Start/log/update
payloads retain their individual values rather than overwriting earlier logs.
Use `parentSpanId` for the tree. Pre-existing root handles reference historical
payloads that are not in Mongo; only new children and updates are captured.

`payload` is JSON text. Binary fields use `{type: "Buffer", encoding: "base64",
data: "..."}` and retain every byte. Payloads over 512 KiB are UTF-8 chunks in
`agent_trace_payloads`, addressed by `_id = eventId + ':' + index`. Fetch indexes
`0..chunkCount-1`, concatenate BSON Binary `data`, then decode UTF-8 and JSON
(multibyte characters can cross chunk boundaries). The header is published only
after all chunks have majority acknowledgement. No 16 MiB document truncation
is introduced.

`AGENT_MONGO_TRACE_RETENTION_DAYS=0` (default) retains all content. A positive
value stamps an identical `expiresAt` on new headers and their chunks; TTL indexes
expire both collections. Changing the setting affects new events only, not
already stamped records, existing history or in-flight events. TTL deletion is
asynchronous and must not be treated as atomic multi-document removal.

The maintenance deletion helper waits up to five seconds for the session's
in-flight local writes before deleting both collections. A timeout fails the
purge rather than reporting success while a write could recreate records.
Stop active turns on **all replicas** first: new or remote in-flight writes can
otherwise recreate data. The HTTP conversation DELETE route remains disabled.
Transcript edits do not rewrite this append-only copy.

## Delivery and capacity

Each event is snapshotted and immediately sent to MongoDB. There is no SQLite
spool, replay worker or application-level waiting queue. Up to three attempts
use the same event/chunk ids and idempotent upserts, with 100 ms and 200 ms
between attempts. Each Mongo operation has a five-second server execution and
write-concern timeout; driver server-selection/pool waits can add time.

Serialization or exhausted delivery failures log `agent.trace.write_failed`
without failing the conversation. Failed events are not retained for later
replay. Process termination or a Mongo outage can lose traces. Partially written
chunks may remain without a header after a failed large event; positive retention
expires them, while retention 0 requires maintenance cleanup if needed.

The store tracks only active writes so shutdown can wait within its existing
guard-flush deadline. It does not cancel writes when the deadline expires.
Concurrency follows event production and the existing Mongo pool; pending writes
retain their full snapshots in memory. Large payloads or a slow database can
increase memory pressure. There is no content truncation or drop-on-full policy.
JSON snapshotting runs on the caller's thread. Full-history inputs can cause
quadratic storage growth over long conversations.

Index failures are logged without preventing backend startup.

## Verification

Run `bun test src/lib/agent/trace-store`. Tests use the real AI SDK with a mock
provider and a fixed output fixture captured from the removed SDK 3.9.0, without
live model/vendor calls or a vendor runtime dependency.
Coverage includes disabled OTel, parent identities, an 18 MB payload, bounded
retries, permanent failure logging, retention timestamps, binary round trips,
startup indexes, flush timeout and purge.

Deploying this version enables full-content Mongo capture automatically. Verify
new collections against representative sessions and monitor write failures,
memory pressure and storage growth. No persistent per-replica volume is needed.
Production parity and historical backfill are not established by unit tests.
Old replicas keep their previous tracing behavior until replaced. This change
does not drain or delete any old SQLite spool; if a deployment enabled one,
drain it with the old version before upgrading. It does not revoke vendor
credentials or delete historical vendor data.
