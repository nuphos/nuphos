//! Operator-driven device sign-in for a runtime nobody provisioned.
//!
//! A runtime an operator started by hand has no pod template, no projected Secret and no
//! exec channel, so the credential its provider CLI mints interactively cannot be seeded
//! from outside. `_openab/runtime/login` starts a configured command inside this container
//! and streams its NDJSON stdout back to the operator as notifications, so a remote
//! application can render the device prompt without ever holding the credential. The call
//! answers once the command is running; its end arrives as a final `exited` frame.
//!
//! OpenAB stays provider-agnostic: it knows only how to run
//! `OPENAB_RUNTIME_LOGIN_COMMAND`, relay whatever JSON objects it prints, and hand it
//! the lines the operator sends back through `_openab/runtime/login/input`.
//!
//! One sign-in runs at a time, and the newest wins: starting one stops whichever is
//! running, so an abandoned attempt can never lock anyone out.

use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::{Sender, UnboundedSender};
use tracing::{info, warn};

/// Cap on one NDJSON frame from the login command, matching the operator-side parser.
const MAX_LOGIN_FRAME_BYTES: usize = 128 * 1024;
/// How long the pipe may still be drained after the command's group has been killed.
const RELAY_DRAIN_SECS: u64 = 5;
/// Cap on one line of operator input, such as an authorization code pasted back.
const MAX_LOGIN_INPUT_BYTES: usize = 4096;
/// Lines accepted ahead of a command that is not reading them.
const LOGIN_INPUT_QUEUE: usize = 4;
/// Notification carrying one frame the login command printed.
pub const LOGIN_FRAME_METHOD: &str = "_openab/runtime/login/frame";
/// The last frame of every sign-in: `{"type":"exited","exitCode":N}`, with -1 when the
/// command was stopped or its output could not be read.
pub const EXITED_FRAME: &str = "exited";

/// No `OPENAB_RUNTIME_LOGIN_COMMAND` is configured for this runtime.
pub const LOGIN_UNSUPPORTED: i32 = -32601;
/// The command could not run, or is not reading its input.
pub const LOGIN_FAILED: i32 = -32006;
/// No sign-in with this `attemptId` is running, so there is nothing to hand input to.
pub const LOGIN_NOT_RUNNING: i32 = -32008;

/// The program and arguments `OPENAB_RUNTIME_LOGIN_COMMAND` names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoginCommand {
    pub program: String,
    pub args: Vec<String>,
}

/// Whitespace-separated argv. Deliberately not a shell: the value is operator
/// configuration for a fixed command, and a shell would turn it into an execution
/// surface for anything that can write the environment.
pub fn parse_login_command(raw: &str) -> Option<LoginCommand> {
    let mut parts = raw.split_whitespace().map(str::to_string);
    let program = parts.next()?;
    Some(LoginCommand {
        program,
        args: parts.collect(),
    })
}

/// An `attemptId` is echoed back to the operator on every frame, so it must be safe to
/// place in a log line and small enough not to be a payload of its own.
pub fn valid_attempt_id(attempt: &str) -> bool {
    !attempt.is_empty()
        && attempt.len() <= 128
        && attempt
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

struct Running {
    attempt: String,
    connection: String,
    pgid: Option<i32>,
    input: Sender<String>,
    stop: tokio::sync::oneshot::Sender<()>,
}

/// Two device flows would race to write the same credential file, so only the newest runs.
static RUNNING: parking_lot::Mutex<Option<Running>> = parking_lot::Mutex::new(None);

/// The slot is runtime-wide, so every test that drives a sign-in — here and in the ACP
/// server's WebSocket suite — has to take this first.
#[cfg(test)]
pub static TEST_GUARD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn stop(running: Running) {
    kill_group(running.pgid);
    let _ = running.stop.send(());
}

/// Start the configured command for `attempt`, stopping any sign-in already running.
/// Its frames, then a final `exited` frame, go to `out_tx`.
///
/// Frame contents are never logged: they carry a device code and, for some providers,
/// the credential itself.
pub fn start(
    command: &LoginCommand,
    attempt: &str,
    connection: &str,
    out_tx: UnboundedSender<String>,
    on_success: Option<Arc<dyn Fn() + Send + Sync>>,
) -> Result<(), (i32, String)> {
    let mut builder = tokio::process::Command::new(&command.program);
    builder
        .args(&command.args)
        .stdin(std::process::Stdio::piped())
        // Provider output can carry secrets and is not ours to interpret; only the
        // command's own NDJSON frames leave this process.
        .stderr(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    builder.process_group(0);
    // Held until the new command is installed, so the one it replaces is dead before it
    // starts and two starts cannot interleave.
    let mut slot = RUNNING.lock();
    if let Some(previous) = slot.take() {
        info!(attempt = %previous.attempt, "runtime sign-in superseded");
        stop(previous);
    }
    let mut child = builder.spawn().map_err(|error| {
        warn!(error = %error, "runtime login command could not start");
        (
            LOGIN_FAILED,
            "Runtime login command could not start".to_string(),
        )
    })?;
    let pgid = child.id().and_then(|pid| i32::try_from(pid).ok());
    // The writer ends when the slot drops its sender, which every exit path does.
    let (input, mut input_rx) = tokio::sync::mpsc::channel::<String>(LOGIN_INPUT_QUEUE);
    let mut stdin = child.stdin.take().expect("stdin is piped");
    tokio::spawn(async move {
        while let Some(line) = input_rx.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
                break;
            }
        }
    });
    let (stop_tx, stopped) = tokio::sync::oneshot::channel();
    *slot = Some(Running {
        attempt: attempt.to_string(),
        connection: connection.to_string(),
        pgid,
        input,
        stop: stop_tx,
    });
    drop(slot);
    info!(attempt = %attempt, "runtime sign-in started");
    tokio::spawn(supervise(
        child,
        pgid,
        attempt.to_string(),
        out_tx,
        stopped,
        on_success,
    ));
    Ok(())
}

async fn supervise(
    mut child: tokio::process::Child,
    pgid: Option<i32>,
    attempt: String,
    out_tx: UnboundedSender<String>,
    stopped: tokio::sync::oneshot::Receiver<()>,
    on_success: Option<Arc<dyn Fn() + Send + Sync>>,
) {
    let stdout = child.stdout.take().expect("stdout is piped");
    let relay = {
        let out_tx = out_tx.clone();
        let attempt = attempt.clone();
        tokio::spawn(async move { relay_frames(stdout, &attempt, &out_tx).await })
    };
    let status = tokio::select! {
        status = child.wait() => Some(status),
        _ = stopped => None,
    };
    // However the command ended, nothing reads stdin any more, so no later line may be
    // acknowledged — not while stdout drains, nor while a stopped command is killed.
    release(&attempt);
    // A descendant that inherited stdout can hold the pipe open long after the command
    // exits, so end the group before waiting for EOF. Bytes already written stay
    // readable once the writers are dead, so no frame is lost.
    kill_group(pgid);
    let exit_code = match status {
        Some(Ok(status)) => {
            let relayed =
                tokio::time::timeout(std::time::Duration::from_secs(RELAY_DRAIN_SECS), relay)
                    .await
                    .unwrap_or_else(|_| Ok(Err(())))
                    .unwrap_or(Err(()));
            match relayed {
                Ok(()) => status.code().unwrap_or(-1),
                Err(()) => -1,
            }
        }
        Some(Err(error)) => {
            warn!(error = %error, "runtime login command did not report an exit status");
            relay.abort();
            -1
        }
        None => {
            let _ = child.kill().await;
            relay.abort();
            -1
        }
    };
    info!(attempt = %attempt, exit_code, "runtime sign-in finished");
    if exit_code == 0 {
        if let Some(hook) = on_success {
            hook();
        }
    }
    let _ = out_tx.send(frame_notification(
        &attempt,
        json!({"type": EXITED_FRAME, "exitCode": exit_code}),
    ));
}

/// One line of input for the command: bounded, and without a line break of its own.
pub fn valid_input(text: &str) -> bool {
    !text.is_empty() && text.len() <= MAX_LOGIN_INPUT_BYTES && !text.contains(['\n', '\r'])
}

/// Write one line to the running sign-in's stdin — for a provider whose browser flow
/// ends in a code the user pastes back. Never logged, for the same reason frames are not.
pub fn send_input(attempt: &str, text: &str) -> Result<(), (i32, String)> {
    if !valid_input(text) {
        return Err((-32602, "Invalid input".to_string()));
    }
    let slot = RUNNING.lock();
    let Some(running) = slot.as_ref().filter(|running| running.attempt == attempt) else {
        return Err((
            LOGIN_NOT_RUNNING,
            "No runtime sign-in with this attemptId is running".to_string(),
        ));
    };
    match running.input.try_send(format!("{text}\n")) {
        Ok(()) => Ok(()),
        Err(TrySendError::Full(_)) => Err((
            LOGIN_FAILED,
            "The sign-in command is not reading its input".to_string(),
        )),
        Err(TrySendError::Closed(_)) => Err((
            LOGIN_NOT_RUNNING,
            "No runtime sign-in with this attemptId is running".to_string(),
        )),
    }
}

fn release(attempt: &str) {
    let mut slot = RUNNING.lock();
    if slot
        .as_ref()
        .is_some_and(|running| running.attempt == attempt)
    {
        *slot = None;
    }
}

/// Stop the running sign-in. `attempt` of `None` stops whichever one is running.
/// Returns whether one was stopped.
pub fn cancel(attempt: Option<&str>) -> bool {
    let mut slot = RUNNING.lock();
    let Some(running) =
        slot.take_if(|running| attempt.is_none_or(|wanted| wanted == running.attempt))
    else {
        return false;
    };
    drop(slot);
    stop(running);
    true
}

/// A sign-in whose operator is gone has nobody to answer the device prompt, so it must
/// not outlive the connection that started it.
pub fn cancel_for_connection(connection: &str) {
    let running = RUNNING
        .lock()
        .take_if(|running| running.connection == connection);
    if let Some(running) = running {
        stop(running);
    }
}

/// The provider CLI launches its own children (a browser opener, a native helper) and
/// they keep the pipes open, so only the whole group going away ends the sign-in.
pub(super) fn kill_group(pgid: Option<i32>) {
    #[cfg(unix)]
    if let Some(pgid) = pgid {
        // SAFETY: `kill` on a process-group id we created ourselves; an already-exited
        // group returns ESRCH, which is the outcome we want anyway.
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    let _ = pgid;
}

fn frame_notification(attempt: &str, frame: Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "method": LOGIN_FRAME_METHOD,
        "params": {"attemptId": attempt, "frame": frame},
    })
    .to_string()
}

/// Split stdout into NDJSON frames and forward each JSON object. A line over the cap
/// fails the sign-in rather than growing a buffer the remote end controls.
async fn relay_frames(
    mut stdout: tokio::process::ChildStdout,
    attempt: &str,
    out_tx: &UnboundedSender<String>,
) -> Result<(), ()> {
    let mut pending = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = match stdout.read(&mut chunk).await {
            Ok(0) => return Ok(()),
            Ok(read) => read,
            Err(_) => return Err(()),
        };
        pending.extend_from_slice(&chunk[..read]);
        if pending.len() > MAX_LOGIN_FRAME_BYTES {
            return Err(());
        }
        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=newline).take(newline).collect();
            let Ok(text) = std::str::from_utf8(&line) else {
                return Err(());
            };
            if text.trim().is_empty() {
                continue;
            }
            let Ok(frame @ Value::Object(_)) = serde_json::from_str::<Value>(text) else {
                return Err(());
            };
            // Only OpenAB ends a sign-in; a command cannot announce its own end early.
            if frame["type"] == EXITED_FRAME {
                return Err(());
            }
            if out_tx.send(frame_notification(attempt, frame)).is_err() {
                return Err(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::UnboundedReceiver;

    fn sh(script: &str) -> LoginCommand {
        LoginCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
        }
    }

    /// Every frame for `attempt`, up to and including its `exited` frame.
    async fn frames_until_exit(rx: &mut UnboundedReceiver<String>, attempt: &str) -> Vec<Value> {
        let mut frames = Vec::new();
        loop {
            let message = tokio::time::timeout(std::time::Duration::from_secs(30), rx.recv())
                .await
                .expect("the sign-in ends")
                .expect("the relay stays open");
            let message: Value = serde_json::from_str(&message).unwrap();
            assert_eq!(message["method"], LOGIN_FRAME_METHOD);
            if message["params"]["attemptId"] != attempt {
                continue;
            }
            let frame = message["params"]["frame"].clone();
            let exited = frame["type"] == EXITED_FRAME;
            frames.push(frame);
            if exited {
                return frames;
            }
        }
    }

    fn running() -> Option<String> {
        RUNNING
            .lock()
            .as_ref()
            .map(|running| running.attempt.clone())
    }

    #[test]
    fn a_command_is_argv_not_a_shell_line() {
        assert_eq!(
            parse_login_command("  node /opt/login.mjs --device  "),
            Some(LoginCommand {
                program: "node".into(),
                args: vec!["/opt/login.mjs".into(), "--device".into()],
            })
        );
        assert_eq!(parse_login_command("   "), None);
    }

    #[test]
    fn an_attempt_id_stays_loggable() {
        assert!(valid_attempt_id("a-b_C9"));
        assert!(!valid_attempt_id(""));
        assert!(!valid_attempt_id("has space"));
        assert!(!valid_attempt_id(&"x".repeat(129)));
    }

    #[tokio::test]
    async fn frames_then_the_exit_reach_the_operator_and_the_slot_is_released() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel();
        start(
            &sh(r#"printf '{"type":"device"}\n{"type":"authenticated"}\n'"#),
            "attempt-1",
            "conn-1",
            out_tx,
            None,
        )
        .unwrap();

        assert_eq!(
            frames_until_exit(&mut out_rx, "attempt-1").await,
            vec![
                json!({"type": "device"}),
                json!({"type": "authenticated"}),
                json!({"type": "exited", "exitCode": 0}),
            ]
        );
        assert_eq!(running(), None);
    }

    #[tokio::test]
    async fn operator_input_reaches_the_running_command_as_one_line() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel();
        start(
            &sh(r#"read line; printf '{"type":"got","line":"%s"}\n' "$line""#),
            "attempt-i",
            "conn-1",
            out_tx,
            None,
        )
        .unwrap();

        assert_eq!(send_input("attempt-i", "two\nlines").unwrap_err().0, -32602);
        assert_eq!(send_input("attempt-i", "").unwrap_err().0, -32602);
        assert_eq!(
            send_input("someone-else", "code#state").unwrap_err().0,
            LOGIN_NOT_RUNNING
        );
        send_input("attempt-i", "code#state").unwrap();

        let frames = frames_until_exit(&mut out_rx, "attempt-i").await;
        assert_eq!(frames[0]["line"], "code#state");
        assert_eq!(frames[1]["exitCode"], 0);
        assert_eq!(
            send_input("attempt-i", "late").unwrap_err().0,
            LOGIN_NOT_RUNNING
        );
    }

    #[tokio::test]
    async fn input_for_a_command_that_does_not_read_it_is_bounded() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, _out_rx) = tokio::sync::mpsc::unbounded_channel();
        start(&sh("sleep 30"), "attempt-q", "conn-1", out_tx, None).unwrap();
        let line = "x".repeat(MAX_LOGIN_INPUT_BYTES);
        let mut refused = None;
        // The pipe buffer absorbs some lines before the queue itself fills.
        for _ in 0..1000 {
            if let Err((code, _)) = send_input("attempt-q", &line) {
                refused = Some(code);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        }

        assert_eq!(refused, Some(LOGIN_FAILED));
        assert!(cancel(Some("attempt-q")));
    }

    #[tokio::test]
    async fn a_new_sign_in_stops_the_one_running() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel();
        start(
            &sh(r#"printf '{"type":"device"}\n'; sleep 120"#),
            "attempt-a",
            "conn-1",
            out_tx.clone(),
            None,
        )
        .unwrap();
        start(
            &sh(r#"printf '{"type":"authenticated"}\n'"#),
            "attempt-b",
            "conn-2",
            out_tx,
            None,
        )
        .unwrap();

        let abandoned = frames_until_exit(&mut out_rx, "attempt-a").await;
        assert_eq!(abandoned.last().unwrap()["exitCode"], -1);
        assert_eq!(
            send_input("attempt-a", "code#state").unwrap_err().0,
            LOGIN_NOT_RUNNING
        );
        assert!(!cancel(Some("attempt-a")), "a stale cancel stops nothing");
        cancel_for_connection("conn-1");
        let successor = frames_until_exit(&mut out_rx, "attempt-b").await;
        assert_eq!(successor.last().unwrap()["exitCode"], 0);
    }

    #[tokio::test]
    async fn a_closed_connection_ends_its_sign_in() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel();
        start(&sh("sleep 30"), "attempt-c", "conn-9", out_tx, None).unwrap();

        cancel_for_connection("someone-else");
        assert_eq!(running().as_deref(), Some("attempt-c"));
        cancel_for_connection("conn-9");
        assert_eq!(running(), None);
        let frames = frames_until_exit(&mut out_rx, "attempt-c").await;
        assert_eq!(frames, vec![json!({"type": "exited", "exitCode": -1})]);
    }

    /// A helper that inherited stdout can outlive the command that spawned it; the
    /// sign-in must still end with the command.
    #[tokio::test]
    async fn a_descendant_holding_stdout_cannot_hold_the_sign_in() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel();
        let started = std::time::Instant::now();
        start(
            &sh(r#"sleep 120 & printf '{"type":"authenticated"}\n'"#),
            "attempt-g",
            "conn-1",
            out_tx,
            None,
        )
        .unwrap();

        let frames = frames_until_exit(&mut out_rx, "attempt-g").await;
        assert_eq!(frames[0]["type"], "authenticated");
        assert_eq!(frames[1]["exitCode"], 0);
        assert!(started.elapsed() < std::time::Duration::from_secs(RELAY_DRAIN_SECS + 5));
        assert_eq!(running(), None);
    }

    #[tokio::test]
    async fn an_oversized_line_fails_the_sign_in() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel();
        start(
            &sh(&format!("printf '%0{}d' 0", MAX_LOGIN_FRAME_BYTES + 1)),
            "attempt-d",
            "conn-1",
            out_tx,
            None,
        )
        .unwrap();

        assert_eq!(
            frames_until_exit(&mut out_rx, "attempt-d").await,
            vec![json!({"type": "exited", "exitCode": -1})]
        );
    }

    #[tokio::test]
    async fn a_command_cannot_forge_the_end_of_its_sign_in() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel();
        start(
            &sh(r#"printf '{"type":"exited","exitCode":0}\n'; exit 0"#),
            "attempt-x",
            "conn-1",
            out_tx,
            None,
        )
        .unwrap();

        assert_eq!(
            frames_until_exit(&mut out_rx, "attempt-x").await,
            vec![json!({"type": "exited", "exitCode": -1})]
        );
    }

    #[tokio::test]
    async fn a_completed_sign_in_runs_the_success_hook_once() {
        let _serialized = TEST_GUARD.lock().await;
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel();
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = calls.clone();
        let hook: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
        start(
            &sh("true"),
            "attempt-e",
            "conn-1",
            out_tx.clone(),
            Some(hook.clone()),
        )
        .unwrap();
        frames_until_exit(&mut out_rx, "attempt-e").await;
        start(&sh("exit 3"), "attempt-f", "conn-1", out_tx, Some(hook)).unwrap();
        let failed = frames_until_exit(&mut out_rx, "attempt-f").await;

        assert_eq!(failed.last().unwrap()["exitCode"], 3);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}
