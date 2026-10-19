//! Where the session token is kept. On macOS it is a generic password in the
//! login keychain, the same item the desktop app reads and writes
//! (`apps/desktop/electron/auth/token-store.ts`), so `cli.yaml` keeps only who
//! is signed in. Elsewhere the token stays in `cli.yaml` (mode 0600) until
//! those platforms get a store both clients can share.

use anyhow::Result;

/// Shared with the desktop app; the account names the user and backend.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const SERVICE: &str = "ai.nuphos.session";

/// Whether a new token goes to the keychain. `NUPHOS_INSECURE_STORAGE=1`
/// keeps it in `cli.yaml`, for a session with no keychain to unlock (an SSH
/// login, a launchd job); a token already in the keychain is still read.
pub fn enabled() -> bool {
    cfg!(target_os = "macos") && std::env::var("NUPHOS_INSECURE_STORAGE").map_or(true, |v| v.is_empty() || v == "0")
}

#[cfg(target_os = "macos")]
mod imp {
    use anyhow::{Context, Result};
    use security_framework::os::macos::keychain::SecKeychain;

    use super::SERVICE;

    /// `errSecItemNotFound`
    const NOT_FOUND: i32 = -25300;

    pub fn get(account: &str) -> Result<Option<String>> {
        match SecKeychain::default()?.find_generic_password(SERVICE, account) {
            Ok((password, _)) => {
                Ok(Some(String::from_utf8(password.to_owned()).context("keychain item is not UTF-8")?))
            }
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(e).context("reading the keychain"),
        }
    }

    /// Updates the item in place when it exists: replacing it would reset the
    /// apps it trusts, and macOS would ask again for each of them.
    pub fn set(account: &str, token: &str) -> Result<()> {
        SecKeychain::default()?.set_generic_password(SERVICE, account, token.as_bytes()).context("writing the keychain")
    }

    pub fn delete(account: &str) -> Result<()> {
        match SecKeychain::default()?.find_generic_password(SERVICE, account) {
            Ok((_, item)) => {
                item.delete();
                Ok(())
            }
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => Err(e).context("reading the keychain"),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use anyhow::{bail, Result};

    pub fn get(_account: &str) -> Result<Option<String>> {
        bail!("no keychain on this platform")
    }

    pub fn set(_account: &str, _token: &str) -> Result<()> {
        bail!("no keychain on this platform")
    }

    pub fn delete(_account: &str) -> Result<()> {
        Ok(())
    }
}

pub fn get(account: &str) -> Result<Option<String>> {
    imp::get(account)
}

pub fn set(account: &str, token: &str) -> Result<()> {
    imp::set(account, token)
}

pub fn delete(account: &str) -> Result<()> {
    imp::delete(account)
}
