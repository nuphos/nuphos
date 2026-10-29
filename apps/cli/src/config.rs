//! Sign-in and preferences on disk. The CLI's sign-in is `~/.config/nuphos/cli.yaml`
//! and the desktop app's is `desktop.yaml` beside it; each signs in and out on
//! its own, and `nuphos login` starts from the desktop's sign-in when there is
//! one. The token itself is in the keychain where there is one (`secret.rs`);
//! the file names the item.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::secret;

const DEFAULT_API_URL: &str = "https://api.nuphos.ai";

/// As the desktop's `Config` (`apps/desktop/electron/auth/config.ts`).
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Session {
    /// Filled from the keychain by `read_session`; written to the file only
    /// when there is no keychain.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// The keychain item holding the token, when it is there.
    #[serde(rename = "keychainAccount", skip_serializing_if = "Option::is_none")]
    pub keychain_account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(rename = "userInfo", skip_serializing_if = "Option::is_none")]
    pub user_info: Option<Value>,
    /// A device or agent token's own record (`kind`, `name`, `teamId`), when
    /// the session is one.
    #[serde(rename = "cliToken", default, skip_serializing_if = "Option::is_none")]
    pub cli_token: Option<Value>,
    /// The token is `NUPHOS_CLI_TOKEN`, not the saved sign-in, which must then
    /// be left alone when the token fails.
    #[serde(skip)]
    pub from_env: bool,
}

/// What this client remembers between runs; the desktop keeps the same
/// choices in its own storage.
#[derive(Debug, Serialize, Deserialize)]
pub struct Prefs {
    #[serde(default, rename = "teamId", skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    /// Last runtime picked for new conversations, per team.
    #[serde(default, rename = "runtimeIds")]
    pub runtime_ids: HashMap<String, String>,
    /// New conversations start in Full Access: the last pick in /full-access.
    #[serde(default = "default_full_access", rename = "fullAccess")]
    pub full_access: bool,
}

fn default_full_access() -> bool {
    true
}

impl Default for Prefs {
    fn default() -> Self {
        Self { team_id: None, runtime_ids: HashMap::new(), full_access: default_full_access() }
    }
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/// `NUPHOS_CLI_CONFIG` or `~/.config/nuphos/cli.yaml`, as on the desktop.
pub fn session_path() -> PathBuf {
    std::env::var_os("NUPHOS_CLI_CONFIG").map(PathBuf::from).unwrap_or_else(|| home().join(".config/nuphos/cli.yaml"))
}

/// The desktop app's sign-in beside this one: `cli.yaml` → `desktop.yaml`,
/// `cli.dev.yaml` → `desktop.dev.yaml` (`apps/desktop/electron/cli-config-path.ts`).
pub fn desktop_session_path() -> PathBuf {
    sibling(&session_path(), "desktop")
}

fn sibling(path: &std::path::Path, name: &str) -> PathBuf {
    let base = path.file_name().and_then(|n| n.to_str()).unwrap_or("cli.yaml");
    let file = match base.strip_prefix("cli") {
        Some(rest) => format!("{name}{rest}"),
        None => format!("{}.{name}.yaml", base.trim_end_matches(".yaml").trim_end_matches(".yml")),
    };
    path.with_file_name(file)
}

/// The desktop app's sign-in, to start the CLI's from. Reading its token from
/// the keychain is what makes macOS ask once.
pub fn read_desktop_session() -> Option<Session> {
    let text = fs::read_to_string(desktop_session_path()).ok()?;
    let mut session = desktop_session_for(&text, &api_url())?;
    if session.token.is_none() {
        session.token = secret::desktop_token(session.keychain_account.as_deref()?).ok().flatten();
    }
    session.keychain_account = None;
    session.token.is_some().then_some(session)
}

/// Whether the desktop app is signed in, without reading its token.
pub fn desktop_signed_in() -> Option<String> {
    let text = fs::read_to_string(desktop_session_path()).ok()?;
    let session = desktop_session_for(&text, &api_url())?;
    if session.token.is_none() && session.keychain_account.is_none() {
        return None;
    }
    let user = session.user_info.as_ref().and_then(|u| u["email"].as_str()).map(String::from);
    Some(user.or(session.user).unwrap_or_else(|| "you".into()))
}

/// The backend that issued the desktop's active sign-in, which it records
/// beside it (`apps/desktop/electron/auth/accounts.ts`).
#[derive(Deserialize)]
struct Issuer {
    api: Option<String>,
}

/// The desktop's active sign-in in `text`, unless another backend than
/// `backend` issued it: a token is never sent to a backend that did not issue
/// it. A file from before the desktop recorded its backend is taken as is.
fn desktop_session_for(text: &str, backend: &str) -> Option<Session> {
    let session = serde_yaml::from_str::<Option<Session>>(text).ok().flatten()?;
    let issuer = serde_yaml::from_str::<Option<Issuer>>(text).ok().flatten().and_then(|i| i.api);
    let same = |api: &str| api.trim().trim_end_matches('/') == backend.trim().trim_end_matches('/');
    match issuer {
        Some(api) if !same(&api) => None,
        _ => Some(session),
    }
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

fn read_session_file() -> Session {
    fs::read_to_string(session_path())
        .ok()
        .and_then(|s| serde_yaml::from_str::<Option<Session>>(&s).ok().flatten())
        .unwrap_or_default()
}

/// The sign-in with its token: `NUPHOS_CLI_TOKEN`, then the keychain, or the
/// file, which moves it to the keychain where there is one. The environment
/// variable is not `NUPHOS_TOKEN`: Nuphos's own agent sandboxes set that one to
/// a conversation credential.
pub fn read_session() -> Session {
    if let Some(token) = std::env::var("NUPHOS_CLI_TOKEN").ok().filter(|t| !t.trim().is_empty()) {
        return Session { token: Some(token.trim().to_string()), from_env: true, ..Session::default() };
    }
    let mut session = read_session_file();
    if session.token.is_some() {
        if secret::enabled() {
            match write_session(&session) {
                Ok(()) => session.keychain_account = read_session_file().keychain_account,
                Err(e) => eprintln!("nuphos: could not move the session token to the keychain: {e:#}"),
            }
        }
        return session;
    }
    if let Some(account) = &session.keychain_account {
        session.token = match secret::get(account) {
            Ok(token) => token,
            Err(e) => {
                eprintln!("nuphos: {e:#}");
                None
            }
        };
    }
    session
}

/// Saves the sign-in, with the token in the keychain where there is one. A
/// session without a token signs out, removing the keychain item too.
pub fn write_session(session: &Session) -> anyhow::Result<()> {
    let path = session_path();
    let previous = read_session_file().keychain_account;
    let Some(token) = &session.token else {
        // Signed out either way; an item left behind is only reported.
        if let Some(Err(e)) = previous.map(|account| secret::delete(&account)) {
            eprintln!("nuphos: could not remove the session token from the keychain: {e:#}");
        }
        return write_private(&path, b"{}\n");
    };
    let mut stored = session.clone();
    stored.keychain_account = None;
    if secret::enabled() {
        let account = keychain_account(session);
        // Update in place only an item this client made: one that was already
        // there could carry another app's access (a pre-created item, as in
        // the XARA attacks), so it is replaced.
        if previous.as_deref() != Some(account.as_str()) {
            let _ = secret::delete(&account);
        }
        match secret::set(&account, token) {
            Ok(()) => {
                stored.token = None;
                stored.keychain_account = Some(account);
            }
            // Still signed in, only less safely: say so rather than fail.
            Err(e) => eprintln!("nuphos: keeping the session token in {} instead: {e:#}", path.display()),
        }
    }
    if let Some(old) = previous.filter(|old| stored.keychain_account.as_ref() != Some(old)) {
        let _ = secret::delete(&old);
    }
    write_private(&path, serde_yaml::to_string(&stored)?.as_bytes())
}

/// One item per user and backend, so a dev backend's sign-in never replaces
/// Nuphos Cloud's.
fn keychain_account(session: &Session) -> String {
    let user = session.user_info.as_ref().and_then(|u| u["id"].as_str()).unwrap_or("default");
    format!("{user}@{}", api_url())
}

/// Signs out after the backend rejected `session`'s token, as the desktop
/// does. A rejected `NUPHOS_CLI_TOKEN` is only reported: the saved sign-in it
/// overrode is a different credential.
pub fn forget_rejected(session: &Session) -> anyhow::Result<()> {
    if session.from_env {
        anyhow::bail!("NUPHOS_CLI_TOKEN was rejected (revoked or expired); unset it or set a valid token");
    }
    write_session(&Session::default())
}

/// Where `read_session` found the token, for `nuphos auth status`.
pub fn token_storage(session: &Session) -> String {
    if session.from_env {
        return "the NUPHOS_CLI_TOKEN environment variable".to_string();
    }
    match &session.keychain_account {
        Some(_) => "macOS Keychain".to_string(),
        None => format!("plaintext in {}", session_path().display()),
    }
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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{desktop_session_for, forget_rejected, read_session_file, sibling, write_private, Prefs, Session};

    #[test]
    fn a_desktop_sign_in_is_taken_only_on_the_backend_that_issued_it() {
        let file = "api: https://nuphos.example.com\ntoken: tok-self\naccounts:\n  - api: https://api.nuphos.ai\n    token: tok-cloud\n";
        let on = |backend: &str| desktop_session_for(file, backend).and_then(|s| s.token);
        assert_eq!(on("https://nuphos.example.com/"), Some("tok-self".into()));
        assert_eq!(on("https://api.nuphos.ai"), None);
        // From before the desktop recorded its backend.
        assert_eq!(
            desktop_session_for("token: tok-old\n", "https://api.nuphos.ai").and_then(|s| s.token),
            Some("tok-old".into())
        );
    }

    #[test]
    fn the_desktop_sign_in_sits_beside_the_cli_one() {
        assert_eq!(
            sibling(Path::new("/h/.config/nuphos/cli.yaml"), "desktop"),
            Path::new("/h/.config/nuphos/desktop.yaml")
        );
        assert_eq!(sibling(Path::new("/d/cli.dev.yaml"), "desktop"), Path::new("/d/desktop.dev.yaml"));
        assert_eq!(sibling(Path::new("/d/session.yaml"), "desktop"), Path::new("/d/session.desktop.yaml"));
    }

    #[test]
    fn a_keychain_session_names_the_item_and_reads_the_desktop_file() {
        let session = Session {
            keychain_account: Some("u1@https://api.nuphos.ai".into()),
            user: Some("Bruce".into()),
            ..Session::default()
        };
        let text = serde_yaml::to_string(&session).unwrap();
        assert!(text.contains("keychainAccount: u1@https://api.nuphos.ai"));
        assert!(!text.contains("token:"));

        // As the desktop app writes it, or an older version with the token.
        let desktop: Session = serde_yaml::from_str("keychainAccount: u1@x\nuserInfo:\n  id: u1\n").unwrap();
        assert_eq!(desktop.keychain_account.as_deref(), Some("u1@x"));
        assert!(desktop.token.is_none());
        let legacy: Session = serde_yaml::from_str("token: tok\n").unwrap();
        assert_eq!(legacy.token.as_deref(), Some("tok"));
    }

    #[test]
    fn a_rejected_env_token_keeps_the_saved_sign_in() {
        let dir = std::env::temp_dir().join(format!("nuphos-cli-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("NUPHOS_CLI_CONFIG", dir.join("cli.yaml"));
        write_private(&dir.join("cli.yaml"), b"token: saved\nkeychainAccount: u1@x\n").unwrap();

        let env = Session { token: Some("revoked".into()), from_env: true, ..Session::default() };
        assert!(forget_rejected(&env).is_err());
        let saved = read_session_file();
        assert_eq!(saved.token.as_deref(), Some("saved"));
        assert_eq!(saved.keychain_account.as_deref(), Some("u1@x"));

        // The saved sign-in itself rejected: signed out.
        let saved = Session { token: Some("saved".into()), ..Session::default() };
        forget_rejected(&saved).unwrap();
        assert!(read_session_file().token.is_none());
        std::env::remove_var("NUPHOS_CLI_CONFIG");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn full_access_defaults_on_but_keeps_an_explicit_auto_mode_choice() {
        assert!(Prefs::default().full_access);
        assert!(serde_json::from_str::<Prefs>("{}").unwrap().full_access);
        assert!(!serde_json::from_str::<Prefs>(r#"{"fullAccess":false}"#).unwrap().full_access);
    }
}
