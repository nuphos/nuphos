//! `nuphos agent` runs the host as a service, so it keeps running after the terminal
//! closes and starts again after a crash or a reboot: the systemd user service
//! `nuphos-agent` on Linux, the LaunchAgent `ai.nuphos.agent` on macOS. Run by a
//! service manager, or on Linux without one, the host runs in the foreground.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};

use crate::agent;

pub const UNIT: &str = "nuphos-agent.service";

/// The LaunchAgent's label; launchd hands it to the job as XPC_SERVICE_NAME.
const LABEL: &str = "ai.nuphos.agent";

/// What the service needs from the shell that installed it. PATH finds node, claude and codex.
const FORWARD: [&str; 4] = ["PATH", "NUPHOS_API_URL", "NUPHOS_DOWNLOAD_URL", "NUPHOS_AGENT_HOME"];

/// How long a join may take before the install reports it as not joined.
const JOIN_WAIT: Duration = Duration::from_secs(60);

/// Whether this run should install the service rather than run the host itself.
/// A unit's own process, this service's or a hand-written one's, has INVOCATION_ID
/// and the service manager as its parent. A shell a terminal service started has
/// only the first, and a process `setsid` left to PID 1 only the second.
pub fn wanted() -> bool {
    if cfg!(target_os = "macos") {
        return std::env::var("XPC_SERVICE_NAME").as_deref() != Ok(LABEL);
    }
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
    if cfg!(target_os = "macos") {
        return install_launch_agent(join);
    }
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
            eprintln!("The agent did not join Nuphos. Its log: journalctl --user -u nuphos-agent");
            let _ = Command::new("journalctl").args(["--user", "-u", UNIT, "-n", "20", "--no-pager"]).status();
            return Ok(1);
        }
    }
    println!("The agent runs as the systemd user service nuphos-agent and starts again after a restart.");
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
    if cfg!(target_os = "macos") {
        let job = format!("{}/{LABEL}", gui_domain());
        if launchctl(&["print", &job]).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success()) {
            println!("Restarting the {LABEL} LaunchAgent on the new version.");
            let _ = launchctl(&["kickstart", "-k", &job]).status();
        }
        return;
    }
    if cfg!(target_os = "linux") && systemctl(&["is-active", "--quiet", UNIT]).status().is_ok_and(|s| s.success()) {
        println!("Restarting the nuphos-agent service on the new version.");
        let _ = systemctl(&["restart", UNIT]).status();
    }
}

/// The LaunchAgent in ~/Library/LaunchAgents, loaded into this user's desktop session.
/// It starts at that user's sign-in, which the Mac's screen needs too; without a desktop
/// session (only SSH) it starts at the next sign-in.
fn install_launch_agent(join: Option<&str>) -> Result<i32> {
    let home = PathBuf::from(std::env::var_os("HOME").context("HOME is not set")?);
    let plist_path = home.join("Library/LaunchAgents").join(format!("{LABEL}.plist"));
    let log = home.join("Library/Logs/nuphos-agent.log");
    let forwarded: Vec<(&str, String)> =
        FORWARD.iter().filter_map(|key| std::env::var(key).ok().map(|value| (*key, value))).collect();
    let exe = std::env::current_exe()?;
    write(&plist_path, &plist(&exe, &forwarded, join, &log))?;
    let domain = gui_domain();
    // Replaces a job loaded from an earlier install; not loaded is fine.
    let _ = launchctl(&["bootout", &format!("{domain}/{LABEL}")]).stderr(Stdio::null()).status();
    let plist_arg = plist_path.display().to_string();
    if !launchctl(&["bootstrap", &domain, &plist_arg]).status().is_ok_and(|s| s.success()) {
        println!("Nobody is signed in to this Mac's desktop, so the agent starts when you sign in.");
        println!("To start it at boot, turn on automatic login for this user.");
        return Ok(0);
    }
    if join.is_some() {
        if !wait_for_credential() {
            eprintln!("The agent did not join Nuphos. Its log: {}", log.display());
            return Ok(1);
        }
        // The token works once; the credential it left replaces it from the next start.
        write(&plist_path, &plist(&exe, &forwarded, None, &log))?;
    }
    println!("The agent runs as the LaunchAgent {LABEL} and starts again when you sign in to this Mac.");
    println!("Log: {}    Stop: launchctl bootout {domain}/{LABEL}", log.display());
    Ok(0)
}

fn gui_domain() -> String {
    let uid = Command::new("id").arg("-u").output().map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned());
    format!("gui/{}", uid.unwrap_or_default())
}

fn launchctl(args: &[&str]) -> Command {
    let mut command = Command::new("launchctl");
    command.args(args);
    command
}

/// Kept alive while it fails; a revoked computer exits 0 under launchd, which has no
/// RestartPreventExitStatus, so it is not started again.
fn plist(exe: &Path, vars: &[(&str, String)], join: Option<&str>, log: &Path) -> String {
    let escape = |text: &str| text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let string = |text: &str| format!("<string>{}</string>", escape(text));
    let join = join.map(|token| ("NUPHOS_JOIN_TOKEN", token.to_owned()));
    let env: String = vars
        .iter()
        .cloned()
        .chain(join)
        .map(|(key, value)| format!("\t\t<key>{key}</key>{}\n", string(&value)))
        .collect();
    let log = string(&log.display().to_string());
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\">\n<dict>\n\
         \t<key>Label</key>{}\n\
         \t<key>ProgramArguments</key><array>{}<string>agent</string></array>\n\
         \t<key>EnvironmentVariables</key>\n\t<dict>\n{env}\t</dict>\n\
         \t<key>RunAtLoad</key><true/>\n\
         \t<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n\
         \t<key>ThrottleInterval</key><integer>10</integer>\n\
         \t<key>StandardOutPath</key>{log}\n\
         \t<key>StandardErrorPath</key>{log}\n\
         </dict>\n</plist>\n",
        string(LABEL),
        string(&exe.display().to_string()),
    )
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

/// Joined once the credential is there, within JOIN_WAIT.
fn wait_for_credential() -> bool {
    let deadline = Instant::now() + JOIN_WAIT;
    while Instant::now() < deadline {
        if agent::joined() {
            return true;
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
    fn plist_keeps_the_agent_alive_with_the_token_only_when_given() {
        let vars = [("PATH", "/usr/bin:/bin".to_owned()), ("NUPHOS_API_URL", "https://a.dev/?x=1&y=<2>".to_owned())];
        let log = Path::new("/Users/a/Library/Logs/nuphos-agent.log");
        let text = plist(Path::new("/Users/a b/.local/bin/nuphos"), &vars, Some("nbj_1"), log);
        assert!(text.contains("<key>Label</key><string>ai.nuphos.agent</string>"));
        assert!(text.contains("<array><string>/Users/a b/.local/bin/nuphos</string><string>agent</string></array>"));
        assert!(text.contains("<key>NUPHOS_API_URL</key><string>https://a.dev/?x=1&amp;y=&lt;2&gt;</string>"));
        assert!(text.contains("<key>NUPHOS_JOIN_TOKEN</key><string>nbj_1</string>"));
        assert!(text.contains("<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>"));
        assert!(!plist(Path::new("/n"), &vars, None, log).contains("NUPHOS_JOIN_TOKEN"));
    }

    #[test]
    fn env_file_holds_the_token_only_when_given() {
        let vars = [("PATH", "/usr/bin:/bin".to_owned()), ("NUPHOS_API_URL", "https://api.dev".to_owned())];
        assert_eq!(env_file(&vars, None), "PATH=/usr/bin:/bin\nNUPHOS_API_URL=https://api.dev\n");
        assert!(env_file(&vars, Some("nbj_1")).ends_with("NUPHOS_JOIN_TOKEN=nbj_1\n"));
    }
}
