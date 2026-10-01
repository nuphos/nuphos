# Debugging a stuck OpenAB runtime session

This runbook is for a Nuphos conversation that appears stuck while its managed
Claude Code or Codex runtime Pod is still running. Its purpose is to preserve
the live state, enter the Pod with `kubectl`, and determine which boundary is
stalled before anyone cancels, restarts, or replaces the runtime.

## What “attach” means here

OpenAB does not start Claude Code or Codex in a terminal. PID 1 starts one ACP
adapter process per pooled conversation with stdin and stdout connected to
anonymous pipes carrying newline-delimited JSON-RPC. The adapter may then start
the native `claude` or `codex` process.

Consequently:

- `kubectl attach` does not reveal a hidden Claude Code or Codex TUI. It attaches
  to the OpenAB container process, not to an interactive child terminal.
- `fg`, `tmux attach`, and `screen -r` cannot work because no shell job or PTY
  owns the ACP process.
- Opening `/proc/<pid>/fd/0` or `/proc/<pid>/fd/1` is unsafe. Reading stdout can
  steal protocol bytes from OpenAB; writing stdin can corrupt JSON-RPC.
- Starting `claude --resume` or `codex resume` is a second client, not an attach
  to the running process. Do not run it against a live session during evidence
  collection.

The useful equivalent of attaching is therefore an interactive shell beside
the processes, plus Pod logs, `/proc`, OpenAB's persisted mappings, native
session files, and cgroup state.

## 1. Select the exact Pod

Run these commands from an operator workstation with the intended kubeconfig
context. Never assume the namespace or select the first Pod returned.

```sh
kubectl config current-context

CTX='replace-with-exact-kube-context'
NS=openab-runtimes
TEAM_ID='replace-with-24-character-workspace-id'

kubectl --context "$CTX" -n "$NS" get pods \
  -l "nuphos.io/team-id=$TEAM_ID" \
  -o custom-columns='POD:.metadata.name,APP:.metadata.labels.app,IMAGE:.spec.containers[?(@.name=="openab")].image,PHASE:.status.phase,STARTED:.status.startTime,RESTARTS:.status.containerStatuses[?(@.name=="openab")].restartCount'
```

There may be several Claude Code and Codex instances for one workspace. Match
the `APP` and image to the runtime selected by the conversation, then copy the
exact name:

```sh
POD='replace-with-exact-pod-name'
kubectl --context "$CTX" -n "$NS" get pod "$POD" -o wide
```

Managed names are normally `openab-team-<teamId>` for the original Claude
runtime, `openab-codex-<teamId>` for the original Codex runtime, or
`openab-claude-<hash>` / `openab-codex-<hash>` for additional instances. Treat
the live Pod labels as authoritative.

## 2. Preserve the outside evidence first

Do this before entering the container. A restart can erase `/workspace`, all
live processes, pipe state, and the current container log. The home PVC
survives, but that is only part of the evidence.

```sh
umask 077
CASE_DIR="openab-debug-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p -m 700 "$CASE_DIR"

kubectl --context "$CTX" -n "$NS" get pod "$POD" -o yaml >"$CASE_DIR/pod.yaml"
kubectl --context "$CTX" -n "$NS" describe pod "$POD" >"$CASE_DIR/pod-describe.txt"
kubectl --context "$CTX" -n "$NS" logs "$POD" -c openab --timestamps --since=6h \
  >"$CASE_DIR/openab.log"
kubectl --context "$CTX" -n "$NS" logs "$POD" -c openab --previous --timestamps \
  >"$CASE_DIR/openab-previous.log" 2>&1 || true
kubectl --context "$CTX" -n "$NS" get events \
  --field-selector "involvedObject.name=$POD" \
  --sort-by='.lastTimestamp' >"$CASE_DIR/events.txt"
kubectl --context "$CTX" -n "$NS" top pod "$POD" --containers \
  >"$CASE_DIR/top.txt" 2>&1 || true
```

The deployed runtime enables debug logs for the ACP path. Those logs can
contain prompts, tool inputs, tool output, session resume capabilities, and
credential-bearing protocol fields. Keep the evidence directory private;
redact it before putting excerpts in a ticket or chat.

Record the current Pod UID, image digest, restart count, start time, node,
termination reason, and recent events. In particular, distinguish a genuinely
live stall from an earlier container restart followed by Nuphos retaining stale
turn state.

## 3. Enter without changing the process tree

```sh
kubectl --context "$CTX" -n "$NS" exec -it "$POD" -c openab -- bash
```

Inside the Pod, record a baseline before experimenting:

```sh
date -Ins
id
pwd
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/statusz | jq .
ps -eo user,pid,ppid,pgid,sid,stat,etime,%cpu,%mem,rss,wchan:32,args --forest
df -h /home/node /workspace
df -i /home/node /workspace
```

`/statusz` reports uptime, outer ACP WebSocket connections, and
`claude-agent-acp` process count. Its `agent_processes` field does not currently
count `codex-acp`, so use `ps` for Codex. It also counts two processes per
pooled Claude session (the wrapper and the agent it spawns), so on a warm pool
it sits at twice `max_sessions` rather than tracking live work. The Settings >
Agent runtime "Sessions" chart therefore plots `acp_connections`, which is the
gateway's own gauge and means the same thing on both providers.

## 4. Correlate the Nuphos conversation to OpenAB

Nuphos uses several identifiers for one conversation:

```text
Nuphos conversation id
  -> durable attachment claudeCodePreview.openabSessionId = sess_<uuid>
  -> OpenAB gateway channel acp_<same uuid>
  -> OpenAB pool key acp:acp_<same uuid>
  -> native adapter session id stored in thread_map.json
```

The outer session id is deliberately not exposed by the ordinary conversation
API because it is a resume capability. Retrieve it with existing authenticated
operator tooling. If a direct local MongoDB query is necessary, use an explicit
`appName` with the required local Codex prefix. From the repository root, with
the operator `MONGODB_URI` already exported:

```sh
export CONVERSATION_ID='replace-with-Nuphos-conversation-id'
export MONGODB_DB=${MONGODB_DB:-atlas}

(
  cd apps/backend
  bun --eval '
    import { MongoClient } from "mongodb";
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is required");
    const client = new MongoClient(uri, {
      appName: "yuanlin-m1-local-codex-openab-runtime-debug",
    });
    try {
      const row = await client
        .db(process.env.MONGODB_DB || "atlas")
        .collection("agent_conversations")
        .findOne(
          { sessionId: process.env.CONVERSATION_ID },
          { projection: { _id: 0, sessionId: 1, teamId: 1, agentRuntime: 1,
            runtimeId: 1, runtimeLabel: 1, claudeCodePreview: 1 } },
        );
      console.log(JSON.stringify(row, null, 2));
    } finally {
      await client.close();
    }
  '
)
```

The returned `claudeCodePreview.runtimeUrl` identifies the runtime instance and
`claudeCodePreview.openabSessionId` is the outer session. Return to the shell
inside the already selected Pod and derive its pool key:

```sh
OUTER_SESSION_ID='replace-with-exact-sess-id'
SESSION_UUID=${OUTER_SESSION_ID#sess_}
POOL_KEY="acp:acp_$SESSION_UUID"

jq --arg key "$POOL_KEY" '{poolKey: $key, nativeSessionId: (.[$key] // null)}' \
  /home/node/.openab/thread_map.json
```

`thread_map.json` contains resumable native session identifiers. Do not paste
its complete contents into shared logs. A null entry can mean the session never
reached successful creation, was reset without a replacement, or the Pod is not
the runtime named by the attachment. Correlate Pod UID, restart time, attachment
URL, and logs rather than guessing another session.

## 5. Inspect the live processes and their pipes

Find the ACP adapter and native CLI descendants:

```sh
pgrep -af 'openab|claude-agent-acp|(^|/)claude($| )|codex-acp|(^|/)codex($| )'
ps -eo pid,ppid,pgid,sid,stat,etime,%cpu,%mem,rss,wchan:32,args --forest
```

For each relevant PID, inspect metadata only:

```sh
PID='replace-with-one-exact-PID-from-ps'

grep -E '^(Name|State|Pid|PPid|Threads|VmRSS|VmSize|FDSize|voluntary_ctxt_switches|nonvoluntary_ctxt_switches):' "/proc/$PID/status"
cat "/proc/$PID/wchan"
cat "/proc/$PID/io"
cat "/proc/$PID/limits"
ls -l "/proc/$PID/fd"
```

Expected ACP adapter fd 0 and fd 1 targets look like `pipe:[123456]`. This
confirms that the process is an ACP subprocess rather than a TTY. Only inspect
the symlink targets; never `cat`, redirect, or write those descriptors.

Useful process-state clues:

| Observation                                     | Likely meaning                                             |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Adapter in `S` with `pipe_read`/`ep_poll`       | Often normal: waiting for OpenAB or the native CLI         |
| Process in `D` for a long time                  | Uninterruptible kernel I/O; inspect volume and node health |
| Native tool descendant consuming CPU            | The tool is still running, not an ACP routing stall        |
| ACP adapter exists but native CLI child is gone | Adapter/native lifecycle failure                           |
| No adapter for the mapped session               | Pool eviction, failed spawn, or a runtime restart          |
| Defunct (`Z`) descendant                        | Parent failed to reap a terminated process                 |

Do not infer a stall from low CPU alone. A healthy model request or permission
wait can be completely idle at the process level.

## 6. Read the protocol timeline from logs

From the operator workstation, narrow the preserved log without editing the
source copy:

```sh
grep -nE 'acp_send|acp_recv|session/prompt|session/update|request_permission|tool_call|cancel|timeout|reader error|failed to spawn|force-evict|session reset|connection closed' \
  "$CASE_DIR/openab.log" >"$CASE_DIR/acp-timeline.txt"
```

Read the surrounding lines for the affected time window. The important
question is which boundary emitted the last frame:

| Last coherent evidence                                 | Suspect boundary                                           |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Outer `session/prompt`, then no inner activity         | OpenAB dispatch/pool acquisition                           |
| Inner prompt sent, then no adapter update              | ACP adapter, native CLI, upstream model, or native tool    |
| `session/request_permission`, then no response         | Nuphos permission relay or user decision path              |
| Tool call starts and a matching process remains        | The tool/process itself                                    |
| Tool call starts, process is gone, no completion frame | Adapter tool-result lifecycle                              |
| Inner completion appears but Nuphos remains busy       | Gateway reply sink, backend stream, or Nuphos turn cleanup |
| `session/cancel` appears but descendants remain        | Cancel propagation or child-process cleanup                |

A particularly strong gateway-fencing signature is:

1. the native adapter emits a successful prompt response such as
   `{"result":{"stopReason":"end_turn"}}`;
2. OpenAB immediately logs `ACP dropping stale reply from a superseded turn`
   for the same channel; and
3. the outer client never receives the matching prompt response.

In that case the native CLI is not stuck. OpenAB rejected the terminal
`GatewayReply` because its `reply_to` did not match the active reply sink's
turn id. The outer prompt remains unresolved until a higher-level watchdog
aborts it. Capture the native response timestamp, the stale-reply lines, the
channel tag, and the later watchdog timestamp; restarting the Pod first erases
the evidence needed to debug the ownership mismatch.

Another Codex-specific signature involves a command that keeps producing
terminal output after the model turn has ended:

1. Codex emits `session_info_update` with `threadStatus.type = idle`, then the
   prompt returns `stopReason = end_turn`;
2. later, the same tool call emits ordinary `tool_call_update` notifications,
   eventually including `status = completed`;
3. no later `session_info_update: idle`, `async_task_state_update`, or other
   terminal session update follows; and
4. Nuphos eventually closes an autonomous run as `producer-stalled`, one stall
   window after the last tool update.

Here the command completed, but Nuphos opened an autonomous turn for the late
tool updates and never saw the boundary it uses to close that turn. Record the
ordering of the pre-update `idle`, the late tool updates, and the final tool
status. Treat this as an adapter/backend lifecycle bug rather than a live
process stall.

Because debug frames may include confidential content, prefer recording frame
direction, method, id, session id, update type, and timestamps in the incident
notes. Include payload bodies only when indispensable and redacted.

To follow new evidence while reproducing the problem:

```sh
kubectl --context "$CTX" -n "$NS" logs -f "$POD" -c openab --timestamps \
  | grep --line-buffered -E 'acp_send|acp_recv|request_permission|tool_call|cancel|timeout|error'
```

## 7. Inspect persisted native session state

Start with filenames, sizes, and modification times; do not immediately dump
the transcript.

For Claude Code:

```sh
find /home/node/.claude/projects -type f -name '*.jsonl' \
  -printf '%T@ %s %p\n' 2>/dev/null | sort -nr | head -20
```

For Codex:

```sh
find /home/node/.codex/sessions -type f -name '*.jsonl' \
  -printf '%T@ %s %p\n' 2>/dev/null | sort -nr | head -20
```

After correlating the correct file by native session id and timestamp, inspect
only its tail in the private shell:

```sh
SESSION_FILE='replace-with-exact-file-selected-above'
stat "$SESSION_FILE"
wc -l -c "$SESSION_FILE"
tail -n 100 "$SESSION_FILE"
```

For Codex, this metadata-only view is usually enough to establish whether the
native turn completed without printing user text or tool output:

```sh
tail -n 100 "$SESSION_FILE" \
  | jq -r '[.timestamp, .type, .payload.type, .payload.item.type,
            .payload.item.status, .payload.turn_id] | map(tostring) | @tsv'
```

Look for a terminal `event_msg task_complete` and the corresponding native
prompt result in the OpenAB log. A later `CommandExecution completed` can be a
background tool finishing after Codex already ended the turn; it does not by
itself mean the model is still running.

Native transcripts may contain user content, commands, tool output, and secrets.
Do not copy an entire home directory or transcript into an incident ticket.
`/home/node` is a persistent PVC, while `/workspace` is an `emptyDir`; a Pod
replacement preserves the former and destroys the latter.

## 8. Check cgroup and node-pressure evidence

The runtime has an 8 GiB memory limit and uses `memory.oom.group=1`, so one
process tree can cause the whole container to be killed. Inside the Pod:

```sh
for file in memory.current memory.max memory.events memory.stat pids.current pids.max; do
  printf '\n### %s\n' "$file"
  cat "/sys/fs/cgroup/$file" 2>/dev/null || true
done

for file in /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io; do
  printf '\n### %s\n' "$file"
  cat "$file" 2>/dev/null || true
done
```

An incremented `oom_kill` in `memory.events`, exit code 137, or a Kubernetes
`OOMKilled` termination reason changes the diagnosis from “session state
machine stuck” to resource exhaustion. Also check a full home PVC, exhausted
inodes, and high I/O pressure before blaming the ACP protocol.

## 9. Recovery comes after evidence collection

Choose the narrowest recovery only after the last good boundary is known:

1. If a native tool is legitimately still running, let it finish or decide
   explicitly whether killing that exact process is safe.
2. If a permission decision is missing, repair or complete the decision path;
   do not restart the runtime first.
3. If only one turn is wedged, use Nuphos's normal cancel action and observe
   whether `session/cancel` reaches the runtime.
4. If one inner session remains corrupt, start a new Nuphos conversation or use
   an existing supported session-reset path rather than killing unrelated
   pooled sessions.
5. Restart or roll the Pod only when the whole runtime is unhealthy or the
   process tree cannot recover. Record the old Pod UID and retain the evidence
   first.

Never begin diagnosis with `kubectl delete pod`, `kubectl rollout restart`,
`kill -9`, editing `thread_map.json`, or deleting native session files. Those
actions destroy the state needed to distinguish a Nuphos bug from an OpenAB,
adapter, tool, resource, or upstream-model failure.

## Incident note checklist

Record these items so the stuck state can be reproduced and fixed:

- Nuphos conversation id, workspace id, provider, and selected runtime label.
- Kubernetes context, namespace, Pod name/UID, image digest, node, start time,
  restart count, and previous termination reason.
- OpenAB pool key and redacted outer/inner session ids.
- Last ACP frame in each direction, with timestamp and method.
- Whether a permission request or tool call lacked its matching response.
- Adapter/native process states, elapsed times, wait channels, descendants,
  and pipe targets.
- `/statusz`, cgroup memory events, Pod resources, disk/inode usage, and recent
  Kubernetes events.
- Whether the native session file was still advancing.
- Exact recovery action and whether the expected cancel/completion frame
  appeared afterward.
