//! `nuphos agent` on Linux with a systemd user manager: the host runs as the user
//! service `nuphos-agent`, so it starts again after a crash or a reboot. Run by
//! a service manager, without one, or on macOS, the host runs in the foreground.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};

use crate::agent;

pub const UNIT: &str = "nuphos-agent.service";

/// What the service needs from the shell that installed it. PATH finds node, claude and codex.
const FORWARD: [&str; 4] = ["PATH", "NUPHOS_API_URL", "NUPHOS_DOWNLOAD_URL", "NUPHOS_AGENT_HOME"];

/// How long a join may take before the install reports it as not joined.
const JOIN_WAIT: Duration = Duration::from_secs(60);

/// Whether this run should install the service rather than run the host itself.
/// A unit's own process, this service's or a hand-written one's, has INVOCATION_ID
/// and the service manager as its parent. A shell a terminal service started has
/// only the first, and a process `setsid` left to PID 1 only the second.
pub fn wanted() -> bool {
    let unit = std::env::var_os("INVOCATION_ID").is_some()
        && is_manager(&std::fs::read_to_string("/proc/self/stat").unwrap_or_default());
    cfg!(target_os = "linux")
        && !unit
        && systemctl(&["show-environment"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

/// Writes the unit and its environment, (re)starts the service and, given a join
/// token, waits until the computer has joined.
pub fn install(join: Option<&str>) -> Result<i32> {
    let config = config_home()?;
    let unit_path = config.join("systemd/user").join(UNIT);
    let env_path = config.join("nuphos/agent.env");
    let forwarded: Vec<(&str, String)> =
        FORWARD.iter().filter_map(|key| std::env::var(key).ok().map(|value| (*key, value))).collect();
    write(&env_path, &env_file(&forwarded, join))?;
    write(&unit_path, &unit(&std::env::current_exe()?, &env_path))?;
    for args in [&["daemon-reload"][..], &["enable", "--quiet", UNIT], &["restart", UNIT]] {
        if !systemctl(args).status().is_ok_and(|s| s.success()) {
            bail!("`systemctl --user {}` failed", args.join(" "));
        }
    }
    if join.is_some() {
        let joined = wait_for_join();
        if joined {
            // The token works once; the credential it left replaces it. Until then a
            // restart may still need it.
            write(&env_path, &env_file(&forwarded, None))?;
        } else {
            eprintln!("The runtime host did not join Nuphos. Its log: journalctl --user -u nuphos-agent");
            let _ = Command::new("journalctl").args(["--user", "-u", UNIT, "-n", "20", "--no-pager"]).status();
            return Ok(1);
        }
    }
    println!("The runtime host runs as the systemd user service nuphos-agent and starts again after a restart.");
    println!("Log: journalctl --user -u nuphos-agent -f    Stop: systemctl --user disable --now nuphos-agent");
    if !lingering() {
        eprintln!(
            "It starts at boot only once you sign in to this computer. To start it at boot, run: sudo loginctl enable-linger {}",
            std::env::var("USER").unwrap_or_else(|_| "$USER".into())
        );
    }
    Ok(0)
}

/// Restarts the service on the newest CLI after `nuphos update`, when it runs.
pub fn restart_if_active() {
    if cfg!(target_os = "linux") && systemctl(&["is-active", "--quiet", UNIT]).status().is_ok_and(|s| s.success()) {
        println!("Restarting the nuphos-agent service on the new version.");
        let _ = systemctl(&["restart", UNIT]).status();
    }
}

/// Whether the parent in `/proc/self/stat` is a systemd manager, the system's or a user's.
fn is_manager(stat: &str) -> bool {
    // The fields after the parenthesized command name: state, then the parent's pid.
    let parent = stat.rsplit_once(") ").and_then(|(_, rest)| rest.split(' ').nth(1));
    parent.is_some_and(|pid| {
        std::fs::read_to_string(format!("/proc/{pid}/comm")).is_ok_and(|comm| comm.trim_end() == "systemd")
    })
}

fn systemctl(args: &[&str]) -> Command {
    let mut command = Command::new("systemctl");
    command.arg("--user").args(args);
    command
}

fn config_home() -> Result<PathBuf> {
    match std::env::var_os("XDG_CONFIG_HOME").filter(|dir| !dir.is_empty()) {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => Ok(PathBuf::from(std::env::var_os("HOME").context("HOME is not set")?).join(".config")),
    }
}

fn write(path: &Path, contents: &str) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::create_dir_all(path.parent().context("no parent directory")?)?;
    // 0600 from the start: the environment may hold the join token.
    let mut file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    // Also when it existed with a wider mode.
    file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    file.write_all(contents.as_bytes()).with_context(|| format!("could not write {}", path.display()))
}

/// Joined once the credential is there; not when the service stopped for good
/// (a refused token exits 78, which it does not restart after) or time ran out.
fn wait_for_join() -> bool {
    let deadline = Instant::now() + JOIN_WAIT;
    while Instant::now() < deadline {
        if agent::joined() {
            return true;
        }
        if systemctl(&["is-failed", "--quiet", UNIT]).status().is_ok_and(|s| s.success()) {
            return false;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    agent::joined()
}

/// Without linger, a user's services start at their first sign-in, not at boot.
fn lingering() -> bool {
    let user = std::env::var("USER").unwrap_or_default();
    let linger = Command::new("loginctl").args(["show-user", &user, "--property=Linger", "--value"]).output();
    if linger.is_ok_and(|out| out.stdout.starts_with(b"yes")) {
        return true;
    }
    // Allowed without a password on some systems.
    Command::new("loginctl")
        .args(["--no-ask-password", "enable-linger"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn unit(exe: &Path, env: &Path) -> String {
    // `%` starts a specifier, and `$` a variable in ExecStart. ExecStart takes a quoted path;
    // EnvironmentFile takes the rest of the line.
    let path = |path: &Path| path.display().to_string().replace('%', "%%");
    let exe = path(exe).replace('$', "$$");
    format!(
        "[Unit]\nDescription=Nuphos local runtimes\n\n[Service]\nExecStart=\"{}\" agent\nEnvironmentFile=-{}\n\
         Restart=always\nRestartSec=10\nRestartPreventExitStatus=78\n\n[Install]\nWantedBy=default.target\n",
        exe,
        path(env),
    )
}

fn env_file(vars: &[(&str, String)], join: Option<&str>) -> String {
    let join = join.map(|token| ("NUPHOS_JOIN_TOKEN", token.to_owned()));
    vars.iter().cloned().chain(join).map(|(key, value)| format!("{key}={value}\n")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_restarts_until_the_computer_is_revoked() {
        let text = unit(Path::new("/home/a b/.local/bin/nuphos"), Path::new("/home/a b/.config/nuphos/agent.env"));
        assert!(text.contains("ExecStart=\"/home/a b/.local/bin/nuphos\" agent\n"));
        assert!(text.contains("EnvironmentFile=-/home/a b/.config/nuphos/agent.env\n"));
        assert!(text.contains("Restart=always\n"));
        assert!(text.contains("RestartPreventExitStatus=78\n"));
        assert!(text.contains("WantedBy=default.target\n"));
    }

    #[test]
    fn unit_escapes_specifiers() {
        assert!(unit(Path::new("/opt/100%/nuphos"), Path::new("/e")).contains("\"/opt/100%%/nuphos\""));
    }

    #[test]
    fn unit_escapes_variables_in_exec_start() {
        assert!(unit(Path::new("/opt/$x/nuphos"), Path::new("/e")).contains("\"/opt/$$x/nuphos\""));
    }

    #[test]
    fn a_shell_is_not_run_by_the_service_manager() {
        // This test's parent is cargo, not systemd; a stat without a parent is not one either.
        assert!(!is_manager(&std::fs::read_to_string("/proc/self/stat").unwrap_or_default()));
        assert!(!is_manager(""));
        assert!(!is_manager("12 (a) b) S"));
    }

    #[test]
    fn env_file_holds_the_token_only_when_given() {
        let vars = [("PATH", "/usr/bin:/bin".to_owned()), ("NUPHOS_API_URL", "https://api.dev".to_owned())];
        assert_eq!(env_file(&vars, None), "PATH=/usr/bin:/bin\nNUPHOS_API_URL=https://api.dev\n");
        assert!(env_file(&vars, Some("nbj_1")).ends_with("NUPHOS_JOIN_TOKEN=nbj_1\n"));
    }
}
