//! Where the session token is kept. On macOS it is a generic password in the
//! login keychain, so `cli.yaml` keeps only who is signed in. The CLI and the
//! desktop app each keep their own item: macOS trusts an item's creator, so
//! neither asks for access when it reads its own. Reading the desktop's item
//! (`desktop_token`, to sign in with it) asks once. Elsewhere the token stays
//! in `cli.yaml` (mode 0600).

use anyhow::Result;

/// The CLI's item; the account names the user and backend.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const SERVICE: &str = "ai.nuphos.cli.session";

/// The desktop app's item (`apps/desktop/electron/auth/token-store.ts`).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const DESKTOP_SERVICE: &str = "ai.nuphos.desktop.session";

/// Whether a new token goes to the keychain: on macOS. A keychain that
/// refuses the write (locked, in an SSH session) leaves it in `cli.yaml`.
pub fn enabled() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(target_os = "macos")]
mod imp {
    use anyhow::{Context, Result};
    use security_framework::os::macos::keychain::SecKeychain;

    /// `errSecItemNotFound`
    const NOT_FOUND: i32 = -25300;

    pub fn get(service: &str, account: &str) -> Result<Option<String>> {
        match SecKeychain::default()?.find_generic_password(service, account) {
            Ok((password, _)) => {
                Ok(Some(String::from_utf8(password.to_owned()).context("keychain item is not UTF-8")?))
            }
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(e).context("reading the keychain"),
        }
    }

    /// Updates the item in place when it exists: replacing it would reset the
    /// apps it trusts, and macOS would ask again for each of them.
    pub fn set(service: &str, account: &str, token: &str) -> Result<()> {
        SecKeychain::default()?.set_generic_password(service, account, token.as_bytes()).context("writing the keychain")
    }

    pub fn delete(service: &str, account: &str) -> Result<()> {
        match SecKeychain::default()?.find_generic_password(service, account) {
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

    pub fn get(_service: &str, _account: &str) -> Result<Option<String>> {
        bail!("no keychain on this platform")
    }

    pub fn set(_service: &str, _account: &str, _token: &str) -> Result<()> {
        bail!("no keychain on this platform")
    }

    pub fn delete(_service: &str, _account: &str) -> Result<()> {
        Ok(())
    }
}

pub fn get(account: &str) -> Result<Option<String>> {
    imp::get(SERVICE, account)
}

pub fn set(account: &str, token: &str) -> Result<()> {
    imp::set(SERVICE, account, token)
}

pub fn delete(account: &str) -> Result<()> {
    imp::delete(SERVICE, account)
}

/// The desktop app's token; macOS asks once whether the CLI may read it.
pub fn desktop_token(account: &str) -> Result<Option<String>> {
    imp::get(DESKTOP_SERVICE, account)
}
