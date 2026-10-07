//! Sign-in and preferences on disk. The sign-in file is the one the desktop app
//! writes (`~/.config/nuphos/cli.yaml`), so signing in or out in either client
//! applies to both.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const DEFAULT_API_URL: &str = "https://api.nuphos.ai";

/// The desktop's `Config` (`apps/desktop/electron/auth/config.ts`).
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Session {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(rename = "userInfo", skip_serializing_if = "Option::is_none")]
    pub user_info: Option<Value>,
}

/// What this client remembers between runs; the desktop keeps the same
/// choices in its own storage.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Prefs {
    #[serde(default, rename = "teamId", skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    /// Last runtime picked for new conversations, per team.
    #[serde(default, rename = "runtimeIds")]
    pub runtime_ids: HashMap<String, String>,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/// `NUPHOS_CLI_CONFIG` or `~/.config/nuphos/cli.yaml`, as on the desktop.
pub fn session_path() -> PathBuf {
    std::env::var_os("NUPHOS_CLI_CONFIG").map(PathBuf::from).unwrap_or_else(|| home().join(".config/nuphos/cli.yaml"))
}

/// Paired with the sign-in file (`cli.yaml` → `cli.api-url`).
fn api_url_path() -> PathBuf {
    session_path().with_extension("api-url")
}

fn prefs_path() -> PathBuf {
    session_path().with_extension("tui.json")
}

/// `NUPHOS_API_URL`, `ATLAS_API_URL`, the endpoint saved on the desktop's
/// sign-in screen, then Nuphos Cloud.
pub fn api_url() -> String {
    for key in ["NUPHOS_API_URL", "ATLAS_API_URL"] {
        if let Ok(v) = std::env::var(key) {
            if !v.trim().is_empty() {
                return v.trim().trim_end_matches('/').to_string();
            }
        }
    }
    fs::read_to_string(api_url_path())
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_API_URL.to_string())
}

/// `NUPHOS_LOGIN_URL`, `NUPHOS_WEB_URL` + `/login`, then nuphos.ai.
pub fn login_url() -> String {
    if let Ok(v) = std::env::var("NUPHOS_LOGIN_URL") {
        if !v.is_empty() {
            return v;
        }
    }
    if let Ok(v) = std::env::var("NUPHOS_WEB_URL") {
        if !v.is_empty() {
            return format!("{}/login", v.trim_end_matches('/'));
        }
    }
    "https://nuphos.ai/login".to_string()
}

pub fn read_session() -> Session {
    fs::read_to_string(session_path())
        .ok()
        .and_then(|s| serde_yaml::from_str::<Option<Session>>(&s).ok().flatten())
        .unwrap_or_default()
}

pub fn write_session(session: &Session) -> anyhow::Result<()> {
    let path = session_path();
    let text = if session.token.is_none() { "{}\n".to_string() } else { serde_yaml::to_string(session)? };
    write_private(&path, text.as_bytes())
}

pub fn read_prefs() -> Prefs {
    fs::read_to_string(prefs_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn write_prefs(prefs: &Prefs) {
    if let Ok(text) = serde_json::to_vec_pretty(prefs) {
        let _ = write_private(&prefs_path(), &text);
    }
}

fn write_private(path: &PathBuf, data: &[u8]) -> anyhow::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(data)?;
    // `mode` applies only when the file is created.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}
