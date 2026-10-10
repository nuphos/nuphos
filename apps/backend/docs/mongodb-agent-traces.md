# MongoDB agent traces

The backend records new agent traces in MongoDB, with independent OpenTelemetry
instrumentation. The Braintrust SDK, exporter, configuration and backfill script
have been removed. No new trace data is sent to Braintrust. Historical vendor
data is not imported or deleted.

## Enablement and privacy

Set `AGENT_MONGO_TRACE_SPOOL_PATH` to a file on a **private, persistent volume
unique to each backend replica**, for example `/var/lib/nuphos/agent-traces.sqlite`.
An unset path disables this additional content copy, including on self-hosted
installations. Do not share a spool between replicas or unrelated deployments.
Mount and restore each replica's volume across restarts; an ephemeral container
filesystem does not provide recovery after replacement.

The SQLite file is mode 0600; newly created parent directories are mode 0700.
Payloads may contain prompts, tool output, credentials printed by tools and error
stacks. There is deliberately no new redaction or truncation: that would violate
the full-content migration contract. Apply the same access, encryption and backup
controls as conversation data to both MongoDB and the spool. SQLite secure-delete
clears acknowledged queue rows; underlying filesystem snapshots/backups have
separate retention. No public read endpoint is introduced. Future readers must
check per-session access, not merely team membership.

## Coverage

- Explicit span start, input, output, metadata, metrics, errors (including stack
  and cause), named events, end, and conversation-root updates.
- The three current `wrapAI` callers (title generation, starter suggestions,
  dashboard insights): generation options, resolved output format, every
  provider `doGenerate` attempt (including failed attempts), and the final AI
  SDK result including getter-backed text, reasoning, steps, tools, token
  usage, response ids and provider metadata.
- Existing step/tool telemetry hooks, including aborted unfinished spans.
- Existing content truncation in step serialization is unchanged;
  the Mongo sink adds no preview limit. Provider transport bodies and response
  headers are excluded, preserving the previous capture contract.

Native `generateText` instrumentation covers current callers; adding another
SDK function to `wrapAI` requires equivalent instrumentation and parity tests.
New spans export self-contained `mongo:` parent handles. Conversation roots use
`conversationTraceParent`; legacy vendor parent fields are left untouched in old
Mongo documents but are not read or reused. Opaque pre-migration handles fall
back to stable hashes without loading a vendor decoder. Ownership metadata
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
already stamped records, existing history or queued events. TTL deletion is
asynchronous and must not be treated as atomic multi-document removal.

The maintenance deletion helper removes locally queued records for the session,
waits only for its active write (up to 5 seconds), then attempts both Mongo
collections' deletion even after delivery errors. Stop active turns on **all
replicas** first: new or slow in-flight writes can otherwise recreate data.
The HTTP conversation DELETE route remains disabled, so this helper is not an
active retention policy. Transcript edits do not rewrite this append-only copy.

## Delivery and capacity

Enqueue snapshots the event into a synchronous SQLite transaction with FULL
synchronization. The database is the queue: there is no unbounded in-memory list
of pending payloads or promises. One consumer per backend reads one event at a
time and submits one Mongo operation at a time on the existing pool. Other trace
payloads remain on disk. There is no drop-on-full or payload cap.

Stable event/chunk ids and idempotent upserts tolerate acknowledgement loss and
replay after a crash. Three failed Mongo attempts leave the row on disk and retry
later; startup replays the same file even without a new event. An unavailable
Mongo destination can therefore grow the spool indefinitely. Monitor persistent
volume capacity and deferred-delivery logs. A permanently invalid event blocks
later delivery until repaired; do not discard it merely to clear the queue.

Full-content capture has a real cost: JSON snapshotting and disk enqueue run on
the caller's thread. Memory is bounded by the largest active event, not by an
arbitrary payload cap; a single exceptionally large event can still exhaust
memory. Validate event-loop latency, disk throughput and storage growth against
representative workloads before deployment. Full-history turn inputs can cause
quadratic storage growth over long conversations.

`agent.trace.enqueue_failed` reports serialization/disk failures (including a
full disk); those events were **not durably accepted**. Tracing does not fail the
user's turn, so this is not an unconditional no-loss guarantee. Also, loss of the
spool volume loses undelivered data. `agent.trace.delivery_deferred` reports
retained events awaiting Mongo delivery. Shutdown drains within the existing
guard-flush deadline, leaves unacknowledged rows on disk and closes the queue.
Index failures are logged without preventing backend startup.

## Verification

Run `bun test src/lib/agent/trace-store`. Tests use the real AI SDK with a mock
provider and a fixed output fixture captured from the removed SDK 3.9.0, without
live model/vendor calls or a vendor runtime dependency.
Coverage includes disabled exporters and opt-out, parent identities, an 18 MB
payload, transient failures, durable replay, single-consumer backpressure,
retention timestamps, binary round trips, cancellation, flush timeout and purge.

Deployment requires the persistent spool to be explicitly enabled for full trace
capture. Removing the vendor does not automatically enable Mongo capture on
existing deployments. Verify new collections against representative sessions,
check enqueue and delivery failures, and size storage/latency before rollout.
Production parity and historical backfill are not established by these tests.
Old replicas keep their previous tracing behavior until replaced; this PR does
not revoke vendor credentials or delete historical vendor data.
