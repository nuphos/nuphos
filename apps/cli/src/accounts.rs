//! The accounts signed in to Nuphos Desktop, for `nuphos auth list/switch` and
//! `--account`. The desktop keeps the active one at the top of `desktop.yaml`
//! and the others in its `accounts` list, each with the backend that issued
//! its token (`apps/desktop/electron/auth/accounts.ts`).

use std::fs;

use anyhow::{anyhow, bail, Result};
use serde_yaml::Value;

use crate::config::{self, Session};
use crate::secret;

/// One desktop account. Its token is read only when it is used.
pub struct DesktopAccount {
    /// `<user id>@<backend>`, as the desktop keys it.
    pub key: String,
    pub api: String,
    /// The email, else the name, for people to recognise it by.
    pub who: String,
    /// The account the desktop is using now.
    pub active: bool,
    session: Session,
}

impl DesktopAccount {
    /// Its sign-in, token included: from the file, or the desktop's keychain
    /// item, which is what makes macOS ask once.
    pub fn sign_in(&self) -> Result<Session> {
        let token = match &self.session.token {
            Some(token) => Some(token.clone()),
            None => match &self.session.keychain_account {
                Some(item) => secret::desktop_token(item)?,
                None => None,
            },
        };
        let token = token.ok_or_else(|| anyhow!("{} has to sign in again in Nuphos Desktop", self.who))?;
        Ok(Session { token: Some(token), keychain_account: None, api: Some(self.api.clone()), ..self.session.clone() })
    }
}

/// Every account signed in to Nuphos Desktop, the active one first.
pub fn desktop_accounts() -> Vec<DesktopAccount> {
    fs::read_to_string(config::desktop_session_path())
        .map(|text| desktop_accounts_in(&text, &config::shared_api_url()))
        .unwrap_or_default()
}

/// `fallback_api` is the backend of an entry from before the desktop recorded one.
fn desktop_accounts_in(text: &str, fallback_api: &str) -> Vec<DesktopAccount> {
    let Ok(file) = serde_yaml::from_str::<Value>(text) else { return Vec::new() };
    let others = file.get("accounts").and_then(Value::as_sequence).cloned().unwrap_or_default();
    std::iter::once((file.clone(), true))
        .chain(others.into_iter().map(|entry| (entry, false)))
        .filter_map(|(entry, active)| account(&entry, active, fallback_api))
        .collect()
}

fn account(entry: &Value, active: bool, fallback_api: &str) -> Option<DesktopAccount> {
    // An `api` that is not a string is not taken, as for the active sign-in.
    let api = match entry.get("api") {
        None | Some(Value::Null) => fallback_api.to_string(),
        Some(Value::String(api)) => api.trim_end_matches('/').to_string(),
        Some(_) => return None,
    };
    let mut session = serde_yaml::from_value::<Session>(entry.clone()).ok()?;
    session.cli_token = None;
    if session.token.is_none() && session.keychain_account.is_none() {
        return None;
    }
    let info = session.user_info.as_ref();
    let id = info.and_then(|u| u["id"].as_str()).unwrap_or("default");
    let who = info
        .and_then(|u| u["email"].as_str())
        .map(String::from)
        .or_else(|| session.user.clone())
        .unwrap_or_else(|| id.to_string());
    Some(DesktopAccount { key: format!("{id}@{}", config::normalized_backend(&api)), api, who, active, session })
}

/// The desktop account `selector` names: its key, or its email when only one
/// account has it (the same email on two backends needs the key).
pub fn find(accounts: Vec<DesktopAccount>, selector: &str) -> Result<DesktopAccount> {
    let selector = selector.trim();
    let mut matches: Vec<DesktopAccount> =
        accounts.into_iter().filter(|a| a.key == selector || a.who.eq_ignore_ascii_case(selector)).collect();
    match matches.len() {
        0 => bail!("no account `{selector}` is signed in to Nuphos Desktop; `nuphos auth list` shows them"),
        1 => Ok(matches.remove(0)),
        _ => bail!("`{selector}` is signed in on more than one backend; name it by its key (`nuphos auth list`)"),
    }
}

/// The CLI's own sign-in as a desktop key, to mark it in `nuphos auth list`.
pub fn key_of(session: &Session) -> Option<String> {
    session.token.as_ref()?;
    let id = session.user_info.as_ref().and_then(|u| u["id"].as_str()).unwrap_or("default");
    Some(format!("{id}@{}", config::normalized_backend(&session.api.clone().unwrap_or_else(config::api_url))))
}

#[cfg(test)]
mod tests {
    use super::{desktop_accounts_in, find};

    const FILE: &str = "\
api: https://api.nuphos.ai
keychainAccount: alex@https://api.nuphos.ai
userInfo: { id: alex, email: alex@example.com }
accounts:
  - api: https://nuphos.example.com/
    token: tok-self
    userInfo: { id: alex, email: alex@example.com }
  - token: tok-legacy
    userInfo: { id: sam, email: sam@example.com }
  - api: 42
    token: tok-bad
    userInfo: { id: bad }
";

    #[test]
    fn every_desktop_account_is_listed_with_the_backend_that_issued_it() {
        let accounts = desktop_accounts_in(FILE, "http://localhost:3718");
        let rows: Vec<(String, String, bool)> =
            accounts.iter().map(|a| (a.key.clone(), a.api.clone(), a.active)).collect();
        assert_eq!(
            rows,
            vec![
                ("alex@https://api.nuphos.ai".into(), "https://api.nuphos.ai".into(), true),
                ("alex@https://nuphos.example.com".into(), "https://nuphos.example.com".into(), false),
                // From before the desktop recorded a backend; loopback as one host.
                ("sam@http://127.0.0.1:3718".into(), "http://localhost:3718".into(), false),
            ]
        );
    }

    #[test]
    fn an_account_is_named_by_its_key_or_an_email_only_one_has() {
        let pick = |s: &str| find(desktop_accounts_in(FILE, "https://api.nuphos.ai"), s).map(|a| a.key);
        assert_eq!(pick("SAM@example.com").unwrap(), "sam@https://api.nuphos.ai");
        assert_eq!(pick("alex@https://nuphos.example.com").unwrap(), "alex@https://nuphos.example.com");
        assert!(pick("alex@example.com").unwrap_err().to_string().contains("more than one backend"));
        assert!(pick("nobody@example.com").is_err());
    }

    #[test]
    fn a_signed_in_account_carries_its_own_backend() {
        let accounts = desktop_accounts_in(FILE, "https://api.nuphos.ai");
        let session = accounts[1].sign_in().unwrap();
        assert_eq!(session.token.as_deref(), Some("tok-self"));
        assert_eq!(session.api.as_deref(), Some("https://nuphos.example.com"));
    }
}
