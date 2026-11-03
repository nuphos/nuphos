//! Where the session token is kept: in the OS credential store, so `cli.yaml`
//! keeps only who is signed in. That is a generic password in the login
//! keychain on macOS, Credential Manager on Windows, and the Secret Service
//! (gnome-keyring, KWallet) on Linux. The CLI and the desktop app each keep
//! their own item: macOS trusts an item's creator, so neither asks for access
//! when it reads its own. Reading the desktop's item (`desktop_token`, to sign
//! in with it) asks once there. Windows and Linux have no per-app access, so
//! nothing asks. A Linux without a Secret Service (a headless server) keeps the
//! token in `cli.yaml` (mode 0600).

use anyhow::Result;

/// The CLI's item; the account names the user and backend.
pub const SERVICE: &str = "ai.nuphos.cli.session";

/// The desktop app's item (`apps/desktop/electron/auth/token-store.ts`).
pub const DESKTOP_SERVICE: &str = "ai.nuphos.desktop.session";

/// Whether a new token goes to the credential store: on macOS and Windows,
/// and on Linux when a Secret Service answers. A store that refuses the write
/// (locked, in an SSH session) leaves it in `cli.yaml`.
pub fn enabled() -> bool {
    imp::available()
}

#[cfg(target_os = "macos")]
mod imp {
    use anyhow::{Context, Result};
    use security_framework::os::macos::keychain::SecKeychain;

    /// `errSecItemNotFound`
    const NOT_FOUND: i32 = -25300;

    pub fn available() -> bool {
        true
    }

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

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod imp {
    use std::sync::{Arc, LazyLock};

    use anyhow::{anyhow, Context, Result};
    use keyring_core::{CredentialStore, Entry, Error};

    #[cfg(target_os = "windows")]
    fn open() -> keyring_core::Result<Arc<CredentialStore>> {
        Ok(windows_native_keyring_store::Store::new()?)
    }

    /// Only the Secret Service: the kernel keyring forgets on reboot, which
    /// would sign the CLI out.
    #[cfg(target_os = "linux")]
    fn open() -> keyring_core::Result<Arc<CredentialStore>> {
        Ok(zbus_secret_service_keyring_store::Store::new()?)
    }

    /// Opened once: on Linux this connects to the Secret Service, and a
    /// machine without one keeps the file without a warning on every run.
    static STORE: LazyLock<Option<Arc<CredentialStore>>> = LazyLock::new(|| open().ok());

    fn store() -> Option<&'static Arc<CredentialStore>> {
        STORE.as_ref()
    }

    pub fn available() -> bool {
        store().is_some()
    }

    fn entry(service: &str, account: &str) -> Result<Entry> {
        let store = store().ok_or_else(|| anyhow!("no credential store on this machine"))?;
        store.build(service, account, None).context("opening the credential store")
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>> {
        match entry(service, account)?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(e).context("reading the credential store"),
        }
    }

    pub fn set(service: &str, account: &str, token: &str) -> Result<()> {
        entry(service, account)?.set_password(token).context("writing the credential store")
    }

    pub fn delete(service: &str, account: &str) -> Result<()> {
        if !available() {
            return Ok(());
        }
        match entry(service, account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(e).context("removing from the credential store"),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    use anyhow::{bail, Result};

    pub fn available() -> bool {
        false
    }

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
