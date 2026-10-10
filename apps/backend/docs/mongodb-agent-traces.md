# MongoDB agent traces

The backend writes new agent traces to MongoDB independently of the Braintrust
and OTel switches. Braintrust remains enabled when configured, for comparison
before removal. This does not import historical Braintrust data.

## Coverage

- Explicit span start, input, output, metadata, metrics, errors (including stack
  and cause), named events, end, and conversation-root updates.
- The three current `wrapAI` callers (title generation, starter suggestions,
  dashboard insights): generation options, resolved output format, every
  provider `doGenerate` attempt (including failed attempts), and the final AI
  SDK result including getter-backed text, reasoning, steps, tools, token
  usage, response ids and provider metadata.
- Existing step/tool telemetry hooks, including aborted unfinished spans.
- Braintrust's existing content truncation in step serialization is unchanged;
  the Mongo sink adds no preview limit. Provider transport bodies and response
  headers are excluded, matching the Braintrust SDK defaults.

Native `generateText` instrumentation covers current callers; adding another
SDK function to `wrapAI` requires equivalent native instrumentation and tests.
Native span ids match Braintrust ids for explicit dual-written spans. Existing
Braintrust parent handles remain unchanged during dual-write, including across
mixed-version replicas. Mongo-only spans export self-contained `mongo:` handles.

## Storage and reading

`agent_trace_events` is append-only. Filter by `sessionId`/`teamId`, `rootSpanId`
or `spanId`; order one span's events by `ts`, then `sequence`. Start/log/update
payloads retain their individual values, rather than overwriting earlier logs.
Events with the same span id reconstruct a span. Use `parentSpanId` for the tree.
For pre-existing conversation handles the old root's historical payload does
not exist in Mongo; new children and updates reference its decoded span id.

`payload` is JSON text. Payloads over 512 KiB are UTF-8 chunks in
`agent_trace_payloads`, addressed by `_id = eventId + ':' + index`. Fetch indexes
`0..chunkCount-1`, concatenate their BSON Binary `data` buffers, then decode
UTF-8 and JSON. Decode after concatenation because a multibyte character can
cross a chunk boundary. The event header is published only after all chunks
have majority acknowledgement; no 16 MiB document limit truncation occurs.
There is no TTL on either collection. The maintenance deletion helper purges
trace events and chunks after waiting only for that session's pending writes;
a write failure does not skip deletion. The current HTTP conversation DELETE
route is disabled, so this hook is not an active retention policy. A still-running
turn can write again after deletion and must be stopped before purging.
These collections contain conversation data and require the same access
restrictions and backups as the other agent collections. No public read endpoint is introduced.

## Delivery and verification

Writes use majority acknowledgement, stable event/chunk ids and three attempts.
They do not block the model. Normal backend shutdown drains pending writes
before closing Mongo, concurrently within the existing guard-flush deadline.
Trace-index setup failures are logged without preventing backend startup. `agent.trace.write_failed` and
`backend.shutdown.trace_flush_failed` report exhausted retries; this is not a
transactional outbox and cannot guarantee delivery after SIGKILL or a prolonged
database outage. Partial chunks from an exhausted upload are not published as
complete events.

Run `bun test src/lib/agent/trace-store/trace-store.test.ts`. Tests use the real
AI SDK with a mock provider and Braintrust's in-memory test logger, with no live
model/vendor calls. They cover disabled sinks, dual-write values/parent ids,
large payload reconstruction, transient/permanent database failures and aborts.
Before removing Braintrust, deploy this version, verify the new collections
against representative sessions and check write failures. Production parity,
retention sizing and historical backfill are not established by unit tests.
