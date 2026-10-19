//! Operator-run, allowlisted one-shot jobs.
//!
//! `_openab/runtime/job` runs a command the image configured in `OPENAB_RUNTIME_JOBS`,
//! feeds it the caller's stdin and returns its capped stdout. The caller names a job and
//! never supplies argv, so OpenAB stays provider-agnostic: what a job does is the image's
//! business.

use super::runtime_login::{kill_group, parse_login_command, valid_attempt_id, LoginCommand};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{info, warn};

/// The job could not start, or was cancelled before it finished.
pub const JOB_FAILED: i32 = -32006;
/// The requested job is not in this runtime's allowlist.
pub const JOB_UNKNOWN: i32 = -32007;

const DEFAULT_MAX_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_MAX_STDOUT_BYTES: usize = 1 << 20;
/// How long stdout may still be drained after the job's group has been killed.
const DRAIN_SECS: u64 = 5;
const FALLBACK_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

#[derive(Clone, Debug)]
pub struct RuntimeJobs {
    commands: BTreeMap<String, LoginCommand>,
    pub max_timeout: Duration,
    pub max_stdout_bytes: usize,
}

impl Default for RuntimeJobs {
    fn default() -> Self {
        Self {
            commands: BTreeMap::new(),
            max_timeout: Duration::from_millis(DEFAULT_MAX_TIMEOUT_MS),
            max_stdout_bytes: DEFAULT_MAX_STDOUT_BYTES,
        }
    }
}

fn valid_job_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

fn positive_env<T: std::str::FromStr + PartialOrd + Default>(name: &str) -> Option<T> {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.trim().parse::<T>().ok())
        .filter(|value| *value > T::default())
}

impl RuntimeJobs {
    pub fn from_env() -> Self {
        let defaults = Self::default();
        Self {
            commands: std::env::var("OPENAB_RUNTIME_JOBS")
                .map(|raw| parse_jobs(&raw))
                .unwrap_or_default(),
            max_timeout: positive_env::<u64>("OPENAB_RUNTIME_JOB_MAX_TIMEOUT_MS")
                .map(Duration::from_millis)
                .unwrap_or(defaults.max_timeout),
            max_stdout_bytes: positive_env("OPENAB_RUNTIME_JOB_MAX_STDOUT_BYTES")
                .unwrap_or(defaults.max_stdout_bytes),
        }
    }

    pub fn with_job(mut self, name: &str, command: LoginCommand) -> Self {
        self.commands.insert(name.to_string(), command);
        self
    }

    pub fn names(&self) -> Vec<&str> {
        self.commands.keys().map(String::as_str).collect()
    }
}

/// `name=argv` entries separated by `;` or newlines. argv is whitespace-separated, never a
/// shell line: the value is image configuration, not a place to put a pipeline.
pub fn parse_jobs(raw: &str) -> BTreeMap<String, LoginCommand> {
    let mut jobs = BTreeMap::new();
    for entry in raw
        .split([';', '\n'])
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        let parsed = entry.split_once('=').and_then(|(name, argv)| {
            let name = name.trim();
            valid_job_name(name)
                .then(|| parse_login_command(argv))
                .flatten()
                .map(|command| (name.to_string(), command))
        });
        match parsed {
            Some((name, command)) => {
                if jobs.insert(name.clone(), command).is_some() {
                    warn!(job = %name, "OPENAB_RUNTIME_JOBS names a job twice; the last entry wins");
                }
            }
            None => warn!("OPENAB_RUNTIME_JOBS has a malformed entry; it is ignored"),
        }
    }
    jobs
}

/// The job's own baseline, plus variables that change what an allowlisted program
/// executes before it reads its input.
fn reserved_env(key: &str) -> bool {
    matches!(
        key,
        "PATH" | "HOME" | "TMPDIR" | "NODE_OPTIONS" | "BASH_ENV" | "ENV" | "SHELLOPTS"
    ) || key.starts_with("LD_")
        || key.starts_with("DYLD_")
}

#[derive(Debug)]
pub struct JobRequest {
    pub job_id: String,
    pub job: String,
    pub stdin: String,
    pub env: Vec<(String, String)>,
    pub timeout: Duration,
    pub max_stdout_bytes: usize,
}

fn optional_u64(params: &Value, key: &str) -> Result<Option<u64>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .map(Some)
            .ok_or_else(|| format!("{key} must be a non-negative integer")),
    }
}

/// Validate the request and clamp its limits to this runtime's maxima.
pub fn parse_request(params: Option<&Value>, jobs: &RuntimeJobs) -> Result<JobRequest, String> {
    let params = params.filter(|p| p.is_object()).ok_or("Missing params")?;
    let job_id = params["jobId"]
        .as_str()
        .filter(|id| valid_attempt_id(id))
        .ok_or("Invalid jobId")?
        .to_string();
    let job = params["job"]
        .as_str()
        .filter(|name| valid_job_name(name))
        .ok_or("Invalid job")?
        .to_string();
    let stdin = match params.get("stdin") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(_) => return Err("stdin must be a string".into()),
    };
    let env = match params.get("env") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Object(map)) => map
            .iter()
            .map(|(key, value)| {
                let value = value.as_str().ok_or("env values must be strings")?;
                if key.is_empty() || key.contains(['=', '\0']) || value.contains('\0') {
                    return Err("env has an invalid entry");
                }
                if reserved_env(key) {
                    return Err("env may not set PATH, HOME, TMPDIR or loader variables");
                }
                Ok((key.clone(), value.to_string()))
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return Err("env must be an object".into()),
    };
    let max_timeout_ms = u64::try_from(jobs.max_timeout.as_millis()).unwrap_or(u64::MAX);
    let timeout_ms = optional_u64(params, "timeoutMs")?
        .unwrap_or(max_timeout_ms)
        .clamp(1, max_timeout_ms);
    let max_stdout_bytes = optional_u64(params, "maxStdoutBytes")?
        .map_or(jobs.max_stdout_bytes, |n| {
            usize::try_from(n).unwrap_or(usize::MAX)
        })
        .min(jobs.max_stdout_bytes);
    Ok(JobRequest {
        job_id,
        job,
        stdin,
        env,
        timeout: Duration::from_millis(timeout_ms),
        max_stdout_bytes,
    })
}

struct Running {
    token: u64,
    connection: String,
    pgid: Option<i32>,
    cancel: Option<tokio::sync::oneshot::Sender<()>>,
}

static RUNNING: parking_lot::Mutex<Option<HashMap<String, Running>>> =
    parking_lot::Mutex::new(None);
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);

/// The job table is runtime-wide, so tests that start jobs take this first.
#[cfg(test)]
pub static TEST_GUARD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
pub fn running_count() -> usize {
    RUNNING.lock().as_ref().map_or(0, HashMap::len)
}

fn claim(
    job_id: &str,
    connection: &str,
) -> Result<(u64, tokio::sync::oneshot::Receiver<()>), (i32, String)> {
    let mut table = RUNNING.lock();
    let running = table.get_or_insert_with(HashMap::new);
    if running.contains_key(job_id) {
        return Err((-32602, "A job with this jobId is already running".into()));
    }
    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = tokio::sync::oneshot::channel();
    running.insert(
        job_id.to_string(),
        Running {
            token,
            connection: connection.to_string(),
            pgid: None,
            cancel: Some(tx),
        },
    );
    Ok((token, rx))
}

/// Apply `update` to the table only while `token` still owns `job_id`: a cancel frees the
/// slot, and the same id may already belong to a newer job.
fn with_owned<R>(
    job_id: &str,
    token: u64,
    update: impl FnOnce(&mut HashMap<String, Running>) -> R,
) -> Option<R> {
    let mut table = RUNNING.lock();
    let running = table.as_mut()?;
    running
        .get(job_id)
        .is_some_and(|entry| entry.token == token)
        .then(|| update(running))
}

/// Kill a running job's process group and free its slot. Returns whether one was running.
pub fn cancel(job_id: &str) -> bool {
    let entry = RUNNING
        .lock()
        .as_mut()
        .and_then(|running| running.remove(job_id));
    let Some(entry) = entry else {
        return false;
    };
    kill_group(entry.pgid);
    if let Some(tx) = entry.cancel {
        let _ = tx.send(());
    }
    true
}

/// Nobody is left to read the result of a job whose connection closed.
pub fn cancel_for_connection(connection: &str) {
    let owned: Vec<String> = RUNNING
        .lock()
        .as_ref()
        .map(|running| {
            running
                .iter()
                .filter(|(_, entry)| entry.connection == connection)
                .map(|(id, _)| id.clone())
                .collect()
        })
        .unwrap_or_default();
    for job_id in owned {
        cancel(&job_id);
    }
}

/// Owns everything a job leaves behind, so an aborted task cleans up as fully as a
/// finished one.
struct JobGuard {
    job_id: String,
    token: u64,
    pgid: Option<i32>,
    dir: Option<PathBuf>,
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        kill_group(self.pgid);
        if let Some(dir) = self.dir.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
        with_owned(&self.job_id, self.token, |running| {
            running.remove(&self.job_id)
        });
    }
}

fn create_job_dir() -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("openab-job-{}", uuid::Uuid::new_v4()));
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(&dir)?;
    Ok(dir)
}

#[derive(Default)]
struct Captured {
    bytes: parking_lot::Mutex<Vec<u8>>,
    truncated: AtomicBool,
}

/// Keep at most `cap` bytes. One byte more means the job cannot produce a usable result,
/// so its group is killed rather than left to run until the deadline.
async fn capture(
    mut stdout: tokio::process::ChildStdout,
    cap: usize,
    pgid: Option<i32>,
    captured: Arc<Captured>,
) {
    let mut chunk = [0_u8; 8192];
    loop {
        let read = match stdout.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(read) => read,
        };
        let mut bytes = captured.bytes.lock();
        let room = cap.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..read.min(room)]);
        if read > room {
            captured.truncated.store(true, Ordering::Release);
            kill_group(pgid);
            return;
        }
    }
}

/// Run an allowlisted job. Never logs stdin, env or output: they carry credentials.
pub async fn run(
    jobs: &RuntimeJobs,
    request: JobRequest,
    connection: &str,
) -> Result<Value, (i32, String)> {
    let Some(command) = jobs.commands.get(&request.job) else {
        return Err((JOB_UNKNOWN, format!("Unknown runtime job: {}", request.job)));
    };
    let (token, cancelled) = claim(&request.job_id, connection)?;
    let mut guard = JobGuard {
        job_id: request.job_id.clone(),
        token,
        pgid: None,
        dir: None,
    };
    let dir = create_job_dir().map_err(|error| {
        warn!(error = %error, "runtime job directory could not be created");
        (JOB_FAILED, "Runtime job could not start".to_string())
    })?;
    guard.dir = Some(dir.clone());

    let mut builder = tokio::process::Command::new(&command.program);
    builder
        .args(&command.args)
        .env_clear()
        .envs(request.env.iter().map(|(k, v)| (k, v)))
        .env(
            "PATH",
            std::env::var("PATH").unwrap_or_else(|_| FALLBACK_PATH.into()),
        )
        .env(
            "HOME",
            std::env::var_os("HOME").unwrap_or_else(|| dir.clone().into_os_string()),
        )
        .env("TMPDIR", &dir)
        .current_dir(&dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(unix)]
    builder.process_group(0);
    let started = std::time::Instant::now();
    let mut child = builder.spawn().map_err(|error| {
        warn!(job = %request.job, error = %error, "runtime job could not start");
        (JOB_FAILED, "Runtime job could not start".to_string())
    })?;
    let pgid = child.id().and_then(|pid| i32::try_from(pid).ok());
    guard.pgid = pgid;
    with_owned(&request.job_id, token, |running| {
        if let Some(entry) = running.get_mut(&request.job_id) {
            entry.pgid = pgid;
        }
    });

    let mut stdin = child.stdin.take().expect("stdin is piped");
    let input = request.stdin.into_bytes();
    let feeder = tokio::spawn(async move {
        let _ = stdin.write_all(&input).await;
    });
    let captured = Arc::new(Captured::default());
    let mut reader = tokio::spawn(capture(
        child.stdout.take().expect("stdout is piped"),
        request.max_stdout_bytes,
        pgid,
        captured.clone(),
    ));

    let mut cancelled = cancelled;
    let outcome = tokio::select! {
        biased;
        _ = &mut cancelled => None,
        status = child.wait() => Some(Some(status)),
        _ = tokio::time::sleep(request.timeout) => Some(None),
    };
    // A cancel kills the group before it signals, so the exit can win the race above.
    let Some(status) = outcome.filter(|_| with_owned(&request.job_id, token, |_| ()).is_some())
    else {
        feeder.abort();
        reader.abort();
        return Err((JOB_FAILED, "Runtime job was cancelled".to_string()));
    };
    let timed_out = status.is_none();
    // A descendant can hold stdout open after the job itself exits; end the whole group
    // before draining so the drain is bounded.
    kill_group(pgid);
    let status = match status {
        Some(status) => status,
        None => {
            let _ = child.kill().await;
            child.wait().await
        }
    };
    feeder.abort();
    if tokio::time::timeout(Duration::from_secs(DRAIN_SECS), &mut reader)
        .await
        .is_err()
    {
        reader.abort();
        warn!(job = %request.job, "runtime job stdout did not close after its group was killed");
    }
    let exit_code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
    let truncated = captured.truncated.load(Ordering::Acquire);
    let stdout = String::from_utf8_lossy(&captured.bytes.lock()).into_owned();
    info!(
        job = %request.job,
        job_id = %request.job_id,
        exit_code,
        timed_out,
        truncated,
        elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        "runtime job finished"
    );
    drop(guard);
    Ok(json!({
        "exitCode": exit_code,
        "stdout": stdout,
        "truncated": truncated,
        "timedOut": timed_out,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(script: &str) -> LoginCommand {
        LoginCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
        }
    }

    fn request(job: &str, job_id: &str, extra: Value) -> JobRequest {
        let mut params = json!({"jobId": job_id, "job": job});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().cloned().unwrap_or_default());
        parse_request(Some(&params), &RuntimeJobs::default()).unwrap()
    }

    fn pid_alive(pid: i32) -> bool {
        // SAFETY: signal 0 only checks whether the pid exists.
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn jobs_are_named_argv_entries() {
        let jobs = parse_jobs(
            "cost-panel=node --max-old-space-size=512 /opt/job.mjs; echo = /bin/echo hi\n\
             bad name=/bin/true;empty=;=/bin/true",
        );
        assert_eq!(jobs.keys().collect::<Vec<_>>(), ["cost-panel", "echo"]);
        assert_eq!(jobs["cost-panel"].program, "node");
        assert_eq!(
            jobs["cost-panel"].args,
            ["--max-old-space-size=512", "/opt/job.mjs"]
        );
        assert_eq!(jobs["echo"].args, ["hi"]);
    }

    #[test]
    fn requested_limits_are_clamped_to_the_runtime_maxima() {
        let jobs = RuntimeJobs::default();
        let big = parse_request(
            Some(&json!({"jobId":"a","job":"j","timeoutMs": 9_999_999, "maxStdoutBytes": 1u64 << 40})),
            &jobs,
        )
        .unwrap();
        assert_eq!(big.timeout, jobs.max_timeout);
        assert_eq!(big.max_stdout_bytes, jobs.max_stdout_bytes);
        let small = parse_request(
            Some(&json!({"jobId":"a","job":"j","timeoutMs": 0, "maxStdoutBytes": 10})),
            &jobs,
        )
        .unwrap();
        assert_eq!(small.timeout, Duration::from_millis(1));
        assert_eq!(small.max_stdout_bytes, 10);
        for bad in [
            json!({"job":"j"}),
            json!({"jobId":"a b","job":"j"}),
            json!({"jobId":"a","job":"../x"}),
            json!({"jobId":"a","job":"j","stdin":1}),
            json!({"jobId":"a","job":"j","env":{"A=B":"x"}}),
            json!({"jobId":"a","job":"j","env":{"A":1}}),
            json!({"jobId":"a","job":"j","timeoutMs":-1}),
            json!({"jobId":"a","job":"j","env":{"PATH":"/tmp/evil"}}),
            json!({"jobId":"a","job":"j","env":{"HOME":"/"}}),
            json!({"jobId":"a","job":"j","env":{"TMPDIR":"/"}}),
            json!({"jobId":"a","job":"j","env":{"NODE_OPTIONS":"--require /x"}}),
            json!({"jobId":"a","job":"j","env":{"LD_PRELOAD":"/x.so"}}),
        ] {
            assert!(parse_request(Some(&bad), &jobs).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn an_unlisted_job_is_refused_without_running_anything() {
        let _serialized = TEST_GUARD.lock().await;
        let jobs = RuntimeJobs::default().with_job("echo", sh("echo hi"));
        let error = run(&jobs, request("cost-panel", "unknown-1", json!({})), "conn")
            .await
            .unwrap_err();
        assert_eq!(error.0, JOB_UNKNOWN);
        assert_eq!(running_count(), 0);
    }

    #[tokio::test]
    async fn the_child_sees_only_path_home_tmpdir_and_the_request_env() {
        let _serialized = TEST_GUARD.lock().await;
        let gateway_only = std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets this for tests");
        let jobs = RuntimeJobs::default().with_job("env", sh("cat >/dev/null; env"));
        let result = run(
            &jobs,
            request(
                "env",
                "env-1",
                json!({"stdin":"ignored","env":{"NUPHOS_TOKEN":"t0k"}}),
            ),
            "conn",
        )
        .await
        .unwrap();
        let stdout = result["stdout"].as_str().unwrap();
        let names: Vec<&str> = stdout
            .lines()
            .filter_map(|line| line.split_once('=').map(|(k, _)| k))
            .collect();
        // `sh` itself exports PWD, SHLVL and `_`.
        let allowed = [
            "HOME",
            "NUPHOS_TOKEN",
            "PATH",
            "PWD",
            "SHLVL",
            "TMPDIR",
            "_",
            "OLDPWD",
        ];
        assert!(names.iter().all(|n| allowed.contains(n)), "{names:?}");
        assert!(stdout.contains("NUPHOS_TOKEN=t0k"));
        assert!(!stdout.contains(&gateway_only));
        assert_eq!(result["exitCode"], 0);
    }

    #[tokio::test]
    async fn stdin_reaches_the_job_and_its_directory_is_removed() {
        let _serialized = TEST_GUARD.lock().await;
        let jobs = RuntimeJobs::default().with_job("echo", sh("pwd -P; cat; exit 3"));
        let result = run(
            &jobs,
            request("echo", "stdin-1", json!({"stdin":"{\"hello\":1}"})),
            "conn",
        )
        .await
        .unwrap();
        let stdout = result["stdout"].as_str().unwrap();
        let (dir, rest) = stdout.split_once('\n').unwrap();
        assert_eq!(rest, "{\"hello\":1}");
        assert_eq!(result["exitCode"], 3);
        assert_eq!(result["truncated"], false);
        assert_eq!(result["timedOut"], false);
        assert!(dir.contains("openab-job-"), "{dir}");
        assert!(!std::path::Path::new(dir).exists());
        assert_eq!(running_count(), 0);
    }

    #[tokio::test]
    async fn a_job_past_its_deadline_is_killed_with_its_descendants() {
        let _serialized = TEST_GUARD.lock().await;
        let jobs =
            RuntimeJobs::default().with_job("slow", sh("sleep 60 & echo $!; printf partial; wait"));
        let started = std::time::Instant::now();
        let result = run(
            &jobs,
            request("slow", "slow-1", json!({"timeoutMs": 300})),
            "conn",
        )
        .await
        .unwrap();
        assert!(started.elapsed() < Duration::from_secs(DRAIN_SECS));
        assert_eq!(result["timedOut"], true);
        assert_eq!(result["exitCode"], -1);
        let stdout = result["stdout"].as_str().unwrap();
        assert!(stdout.ends_with("partial"), "{stdout}");
        let descendant: i32 = stdout.lines().next().unwrap().parse().unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!pid_alive(descendant));
        assert_eq!(running_count(), 0);
    }

    #[tokio::test]
    async fn stdout_past_the_cap_is_truncated_and_the_job_stopped() {
        let _serialized = TEST_GUARD.lock().await;
        let jobs = RuntimeJobs::default().with_job("flood", sh("yes x"));
        let started = std::time::Instant::now();
        let result = run(
            &jobs,
            request(
                "flood",
                "flood-1",
                json!({"maxStdoutBytes": 1000, "timeoutMs": 60_000}),
            ),
            "conn",
        )
        .await
        .unwrap();
        assert!(started.elapsed() < Duration::from_secs(10));
        assert_eq!(result["truncated"], true);
        assert_eq!(result["timedOut"], false);
        assert_eq!(result["stdout"].as_str().unwrap().len(), 1000);
    }

    #[tokio::test]
    async fn many_jobs_run_at_once_and_each_job_id_runs_once() {
        let _serialized = TEST_GUARD.lock().await;
        let jobs = Arc::new(RuntimeJobs::default().with_job("slow", sh("sleep 60")));
        let ids: Vec<String> = (0..16).map(|n| format!("many-{n}")).collect();
        let mut running = Vec::new();
        for id in &ids {
            let (jobs, id) = (jobs.clone(), id.clone());
            running.push(tokio::spawn(async move {
                run(&jobs, request("slow", &id, json!({})), "conn-many").await
            }));
        }
        while running_count() < ids.len() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let duplicate = run(&jobs, request("slow", "many-0", json!({})), "conn-many")
            .await
            .unwrap_err();
        assert_eq!(duplicate.0, -32602);

        assert!(cancel("many-0"));
        assert!(!cancel("many-0"));
        cancel_for_connection("conn-many");
        for task in running {
            assert_eq!(task.await.unwrap().unwrap_err().0, JOB_FAILED);
        }
        assert_eq!(running_count(), 0);
    }

    #[tokio::test]
    async fn an_aborted_job_task_kills_its_group_and_frees_its_slot() {
        let _serialized = TEST_GUARD.lock().await;
        let marker = std::env::temp_dir().join(format!("openab-job-pid-{}", uuid::Uuid::new_v4()));
        let jobs = Arc::new(RuntimeJobs::default().with_job(
            "slow",
            sh(&format!("sleep 60 & echo $! > {}; wait", marker.display())),
        ));
        let task = {
            let jobs = jobs.clone();
            tokio::spawn(
                async move { run(&jobs, request("slow", "abort-1", json!({})), "c").await },
            )
        };
        let pid = loop {
            if let Some(pid) = std::fs::read_to_string(&marker)
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
            {
                break pid;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        task.abort();
        let _ = task.await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!pid_alive(pid));
        assert_eq!(running_count(), 0);
        let _ = std::fs::remove_file(marker);
    }
}
