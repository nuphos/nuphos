//! Operator-only interactive PTYs. Each socket owns its processes; disconnect kills them.
use serde_json::{json, Value};
use tokio::sync::mpsc::{self, UnboundedSender};

pub const FRAME_METHOD: &str = "_openab/runtime/terminal/frame";
pub fn enabled() -> bool {
    cfg!(unix)
        && std::env::var("OPENAB_RUNTIME_TERMINAL_CWD")
            .is_ok_and(|v| std::path::Path::new(&v).is_absolute())
}

pub struct Terminals {
    running: std::collections::HashMap<String, mpsc::Sender<Value>>,
}
impl Terminals {
    pub fn new() -> Self {
        Self {
            running: Default::default(),
        }
    }
    pub fn request(
        &mut self,
        method: &str,
        params: &Value,
        output: UnboundedSender<String>,
    ) -> Result<Value, String> {
        if !enabled() {
            return Err("Interactive terminal is not enabled on this runtime".into());
        }
        let id = params["terminalId"]
            .as_str()
            .filter(|s| super::runtime_login::valid_attempt_id(s))
            .ok_or("Invalid terminal id")?;
        self.running.retain(|_, tx| !tx.is_closed());
        if method.ends_with("/start") {
            if self.running.contains_key(id) {
                return Err("Terminal already exists".into());
            }
            #[cfg(unix)]
            {
                let tx = unix::start(id, params, output).map_err(|_| "Could not start terminal")?;
                self.running.insert(id.into(), tx);
                return Ok(json!({"started":true}));
            }
            #[cfg(not(unix))]
            {
                let _ = output;
                return Err("Terminal unavailable on this platform".into());
            }
        }
        if method.ends_with("/close") {
            self.running.remove(id);
            return Ok(json!({"closed":true}));
        }
        let tx = self.running.get(id).ok_or("Terminal no longer exists")?;
        if method.ends_with("/input") && params["data"].as_str().is_none_or(|s| s.len() > 16384) {
            return Err("Invalid terminal input".into());
        }
        tx.try_send(json!({"method":method,"params":params}))
            .map_err(|_| "Terminal input queue is full")?;
        Ok(json!({}))
    }
}

#[cfg(unix)]
mod unix {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{
        io,
        os::fd::{AsRawFd, FromRawFd, OwnedFd},
        process::Stdio,
    };
    use tokio::io::unix::AsyncFd;

    // Shared across every ACP connection and backend replica connected to this process.
    static CAPACITY: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(16);

    fn size(value: &Value, fallback: u16) -> u16 {
        value
            .as_u64()
            .map(|n| n.clamp(2, 500) as u16)
            .unwrap_or(fallback)
    }
    fn resize(fd: i32, params: &Value) -> io::Result<()> {
        let size = libc::winsize {
            ws_row: size(&params["rows"], 24),
            ws_col: size(&params["cols"], 80),
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        if unsafe { libc::ioctl(fd, libc::TIOCSWINSZ, &size) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    // Match the runtime adapters' session-home contract. Never inherit runtime secrets.
    fn session_environment(session: &str) -> io::Result<std::collections::HashMap<String, String>> {
        let root = std::path::PathBuf::from(
            std::env::var("OPENAB_RUNTIME_TERMINAL_HOME")
                .or_else(|_| std::env::var("HOME"))
                .map_err(io::Error::other)?,
        );
        let home = root
            .join(".nuphos/session-homes")
            .join(format!("{:x}", Sha256::digest(session.as_bytes())));
        use std::os::unix::fs::PermissionsExt;
        for dir in [home.parent().unwrap(), home.as_path()] {
            std::fs::create_dir_all(dir)?;
            if std::fs::symlink_metadata(dir)?.file_type().is_symlink() {
                return Err(io::Error::other("Invalid session home"));
            }
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        let home = home.to_string_lossy().into_owned();
        let mut env = std::collections::HashMap::from([
            ("HOME".into(), home.clone()),
            ("NUPHOS_SESSION_HOME".into(), home.clone()),
            ("NUPHOS_SESSION_ID".into(), session.into()),
            ("TERM".into(), "xterm-256color".into()),
            (
                "PATH".into(),
                format!(
                    "{home}/.local/bin:{}",
                    std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into())
                ),
            ),
        ]);
        for (key, path) in [
            ("XDG_CONFIG_HOME", ".config"),
            ("XDG_CACHE_HOME", ".cache"),
            ("XDG_DATA_HOME", ".local/share"),
            ("XDG_STATE_HOME", ".local/state"),
            ("CLOUDSDK_CONFIG", ".config/gcloud"),
            ("GH_CONFIG_DIR", ".config/gh"),
            ("AWS_SHARED_CREDENTIALS_FILE", ".aws/credentials"),
            ("AWS_CONFIG_FILE", ".aws/config"),
            ("KUBECONFIG", ".kube/config"),
            ("AZURE_CONFIG_DIR", ".azure"),
            ("DOCKER_CONFIG", ".docker"),
            ("GIT_CONFIG_GLOBAL", ".gitconfig"),
            ("NPM_CONFIG_USERCONFIG", ".npmrc"),
            ("GNUPGHOME", ".gnupg"),
        ] {
            env.insert(key.into(), format!("{home}/{path}"));
        }
        env.insert("GIT_CONFIG_NOSYSTEM".into(), "1".into());
        Ok(env)
    }
    async fn write_input(master: &AsyncFd<OwnedFd>, mut remaining: &[u8]) -> io::Result<()> {
        while !remaining.is_empty() {
            let mut ready = master.writable().await?;
            match ready.try_io(|fd| {
                let n = unsafe {
                    libc::write(
                        fd.get_ref().as_raw_fd(),
                        remaining.as_ptr().cast(),
                        remaining.len(),
                    )
                };
                if n < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(n as usize)
                }
            }) {
                Ok(Ok(n)) if n > 0 => remaining = &remaining[n..],
                Ok(Ok(_)) => return Err(io::Error::other("Terminal closed")),
                Ok(Err(error)) => return Err(error),
                Err(_) => {}
            }
        }
        Ok(())
    }
    pub fn start(
        id: &str,
        params: &Value,
        output: UnboundedSender<String>,
    ) -> io::Result<mpsc::Sender<Value>> {
        let permit = CAPACITY
            .try_acquire()
            .map_err(|_| io::Error::other("Too many terminals"))?;
        let session = params["sessionId"]
            .as_str()
            .filter(|s| super::super::runtime_login::valid_attempt_id(s))
            .ok_or_else(|| io::Error::other("Invalid session"))?;
        let env = session_environment(session)?;
        let (mut master, mut slave) = (-1, -1);
        if unsafe {
            libc::openpty(
                &mut master,
                &mut slave,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        let master = unsafe { OwnedFd::from_raw_fd(master) };
        let slave = unsafe { OwnedFd::from_raw_fd(slave) };
        for fd in [&master, &slave] {
            if unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
                return Err(io::Error::last_os_error());
            }
        }
        resize(master.as_raw_fd(), params)?;
        let mut command = tokio::process::Command::new("/bin/sh");
        command
            .arg("-i")
            .env_clear()
            .envs(env)
            .current_dir(std::env::var("OPENAB_RUNTIME_TERMINAL_CWD").map_err(io::Error::other)?)
            .stdin(Stdio::from(slave.try_clone()?))
            .stdout(Stdio::from(slave.try_clone()?))
            .stderr(Stdio::from(slave))
            .kill_on_drop(true);
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 || libc::ioctl(0, libc::TIOCSCTTY as _, 0) < 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn()?;
        let pid = child.id().unwrap() as i32;
        if unsafe { libc::fcntl(master.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let master = AsyncFd::new(master)?;
        let (tx, mut rx) = mpsc::channel::<Value>(32);
        let id = id.to_string();
        tokio::spawn(async move {
            let _permit = permit;
            let frame = |value: Value| {
                output.send(json!({"jsonrpc":"2.0","method":FRAME_METHOD,"params":{"terminalId":id,"frame":value}}).to_string())
            };
            let mut buffer = [0u8; 4096];
            let mut sent = 0u64;
            let mut acknowledged = 0u64;
            loop {
                tokio::select! {

                    input = rx.recv() => {
                        let Some(input) = input else { break; };
                        if input["method"].as_str().is_some_and(|s|s.ends_with("/ack")) {
                            if let Some(sequence) = input["params"]["sequence"].as_u64() {
                                if sequence > acknowledged && sequence <= sent { acknowledged = sequence; }
                            }
                        } else if input["method"].as_str().is_some_and(|s|s.ends_with("/resize")) {
                            if resize(master.get_ref().as_raw_fd(),&input["params"]).is_err() { break; }
                        } else if let Some(data) = input["params"]["data"].as_str() {
                            if !matches!(tokio::time::timeout(std::time::Duration::from_secs(1), write_input(&master, data.as_bytes())).await, Ok(Ok(()))) { break; }
                        }
                    }
                    ready = master.readable(), if sent - acknowledged < 8 => {
                        let Ok(mut ready) = ready else { break; };
                        let result = ready.try_io(|fd| {
                            let n = unsafe { libc::read(fd.get_ref().as_raw_fd(),buffer.as_mut_ptr().cast(),buffer.len()) };
                            if n < 0 { Err(io::Error::last_os_error()) } else { Ok(n as usize) }
                        });
                        match result {
                            Ok(Ok(n)) if n > 0 => {
                                use base64::Engine;
                                sent += 1;
                                if frame(json!({"type":"data","sequence":sent,"data":base64::engine::general_purpose::STANDARD.encode(&buffer[..n])})).is_err() { break; }
                            }
                            Ok(_) => break,
                            Err(_) => {}
                        }
                    }
                }
            }
            drop(master);
            // Kill before reaping, so the shell PID cannot be reused for another group.
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            let _ = child.start_kill();
            let exit_code = child
                .wait()
                .await
                .ok()
                .and_then(|status| status.code())
                .unwrap_or(-1);
            let _ = frame(json!({"type":"exit","code":exit_code}));
        });
        Ok(tx)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use base64::Engine;
    use std::time::Duration;

    #[tokio::test]
    async fn pty_capacity_is_shared_across_connections_and_released_on_exit() {
        let _guard = super::super::runtime_login::TEST_GUARD.lock().await;
        let root = std::env::temp_dir().join(format!("runtime-pty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::env::set_var("OPENAB_RUNTIME_TERMINAL_CWD", &root);
        std::env::set_var("OPENAB_RUNTIME_TERMINAL_HOME", &root);
        let (out, mut frames) = mpsc::unbounded_channel();
        let params = json!({"terminalId":"same-id-on-each-socket","sessionId":"conversation"});
        let mut sockets = Vec::new();
        for _ in 0..16 {
            let mut socket = Terminals::new();
            socket.request("/start", &params, out.clone()).unwrap();
            sockets.push(socket);
        }
        let mut spare = Terminals::new();
        assert!(spare.request("/start", &params, out.clone()).is_err());
        drop(sockets.pop());
        async fn exited(frames: &mut mpsc::UnboundedReceiver<String>) {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let value: Value = serde_json::from_str(&frames.recv().await.unwrap()).unwrap();
                    if value["params"]["frame"]["type"] == "exit" {
                        break;
                    }
                }
            })
            .await
            .unwrap();
        }
        exited(&mut frames).await;
        spare.request("/start", &params, out).unwrap();
        drop(spare);
        drop(sockets);
        for _ in 0..16 {
            exited(&mut frames).await;
        }
        std::env::remove_var("OPENAB_RUNTIME_TERMINAL_CWD");
        std::env::remove_var("OPENAB_RUNTIME_TERMINAL_HOME");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn duplicate_and_future_acknowledgements_do_not_release_output() {
        // Runtime login and terminal tests share process-global environment variables.
        let _guard = super::super::runtime_login::TEST_GUARD.lock().await;
        let root = std::env::temp_dir().join(format!("runtime-pty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::env::set_var("OPENAB_RUNTIME_TERMINAL_CWD", &root);
        std::env::set_var("OPENAB_RUNTIME_TERMINAL_HOME", &root);
        let (out, mut frames) = mpsc::unbounded_channel();
        let tx = unix::start("flow", &json!({"sessionId":"conversation"}), out).unwrap();
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(root.join(".nuphos/session-homes"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        tx.send(json!({"method":"/input","params":{"data":"yes output\n"}}))
            .await
            .unwrap();
        for expected in 1..=8 {
            let raw = tokio::time::timeout(Duration::from_secs(5), frames.recv())
                .await
                .unwrap()
                .unwrap();
            let value: Value = serde_json::from_str(&raw).unwrap();
            assert_eq!(value["params"]["frame"]["sequence"], expected);
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(100), frames.recv())
                .await
                .is_err()
        );
        tx.send(json!({"method":"/ack","params":{"sequence":1}}))
            .await
            .unwrap();
        let raw = tokio::time::timeout(Duration::from_secs(5), frames.recv())
            .await
            .unwrap()
            .unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["params"]["frame"]["sequence"], 9);
        for sequence in [1, 1, 0, 1000] {
            tx.send(json!({"method":"/ack","params":{"sequence":sequence}}))
                .await
                .unwrap();
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(100), frames.recv())
                .await
                .is_err()
        );
        drop(tx);
        let raw = tokio::time::timeout(Duration::from_secs(5), frames.recv())
            .await
            .unwrap()
            .unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["params"]["frame"]["type"], "exit");
        std::env::remove_var("OPENAB_RUNTIME_TERMINAL_CWD");
        std::env::remove_var("OPENAB_RUNTIME_TERMINAL_HOME");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn pty_input_resize_interrupt_and_disconnect() {
        let _guard = super::super::runtime_login::TEST_GUARD.lock().await;
        let root = std::env::temp_dir().join(format!("runtime-pty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::env::set_var("OPENAB_RUNTIME_TERMINAL_CWD", &root);
        std::env::set_var("OPENAB_RUNTIME_TERMINAL_HOME", &root);
        let (out, mut frames) = mpsc::unbounded_channel();
        let tx = unix::start(
            "test",
            &json!({"sessionId":"conversation","rows":24,"cols":80}),
            out,
        )
        .unwrap();
        tx.send(json!({"method":"/input","params":{"data":"PS1='PTY_PROMPT>'; stty -echo; test -t 0 && printf '\\nPTY_READY\\n'; stty size\n"}})).await.unwrap();
        let mut text = String::new();
        async fn until(
            frames: &mut mpsc::UnboundedReceiver<String>,
            tx: &mpsc::Sender<Value>,
            text: &mut String,
            needle: &str,
        ) {
            tokio::time::timeout(Duration::from_secs(5), async {
                while !text.contains(needle) {
                    let value: Value = serde_json::from_str(&frames.recv().await.unwrap()).unwrap();
                    if let Some(data) = value["params"]["frame"]["data"].as_str() {
                        tx.send(json!({"method":"/ack","params":{"sequence":value["params"]["frame"]["sequence"]}})).await.unwrap();
                        text.push_str(&String::from_utf8_lossy(
                            &base64::engine::general_purpose::STANDARD
                                .decode(data)
                                .unwrap(),
                        ));
                    }
                }
            })
            .await
            .unwrap_or_else(|_| panic!("missing {needle:?}, output {text:?}"));
        }
        // Wait for the shell to finish its initial command before resizing.
        until(&mut frames, &tx, &mut text, "\r\n24 80\r\nPTY_PROMPT>").await;
        assert!(text.contains("\r\nPTY_READY\r\n"));
        tx.send(json!({"method":"/resize","params":{"rows":35,"cols":120}}))
            .await
            .unwrap();
        tx.send(json!({"method":"/input","params":{"data":"stty size\n"}}))
            .await
            .unwrap();
        until(&mut frames, &tx, &mut text, "35 120\r\n").await;
        tx.send(json!({"method":"/input","params":{"data":"sleep 30\n"}}))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        tx.send(json!({"method":"/input","params":{"data":"\u{3}printf '\\nINTERRUPTED\\n'\n"}}))
            .await
            .unwrap();
        until(&mut frames, &tx, &mut text, "\r\nINTERRUPTED\r\n").await;
        drop(tx);
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let value: Value = serde_json::from_str(&frames.recv().await.unwrap()).unwrap();
                if value["params"]["frame"]["type"] == "exit" {
                    break;
                }
            }
        })
        .await
        .unwrap();
        std::env::remove_var("OPENAB_RUNTIME_TERMINAL_CWD");
        std::env::remove_var("OPENAB_RUNTIME_TERMINAL_HOME");
        std::fs::remove_dir_all(root).unwrap();
    }
}
