//! New releases: the TUI checks for one on start, and `nuphos update`
//! installs it by running the install script from that release's tag, so
//! what runs is what shipped with it rather than whatever is on main.

use std::time::Duration;

use anyhow::{anyhow, bail, Result};

/// Nuphos Cloud's answer whichever backend this CLI uses: releases are global,
/// and the GitHub API this used to ask rate-limits shared IPs.
const LATEST: &str = "https://api.nuphos.ai/cli/latest";

/// The newest published CLI version.
pub async fn latest() -> Option<String> {
    let text = reqwest::Client::new()
        .get(LATEST)
        .header("user-agent", concat!("nuphos-cli/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .text()
        .await
        .ok()?;
    let version = text.trim();
    parse(version).map(|_| version.to_string())
}

fn parse(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.split('.').map(|p| p.parse().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

pub fn is_newer(version: &str) -> bool {
    match (parse(version), parse(env!("CARGO_PKG_VERSION"))) {
        (Some(new), Some(current)) => new > current,
        _ => false,
    }
}

/// `NUPHOS_NO_UPDATE_CHECK=1` turns the check on start off.
pub fn check_enabled() -> bool {
    std::env::var_os("NUPHOS_NO_UPDATE_CHECK").is_none()
}

/// `nuphos update`: installs the newest release over this binary.
pub async fn update() -> Result<i32> {
    let current = env!("CARGO_PKG_VERSION");
    let latest = latest().await.ok_or_else(|| anyhow!("could not look up the newest release at {LATEST}"))?;
    if !is_newer(&latest) {
        println!("nuphos {current} is up to date.");
        return Ok(0);
    }
    let exe = std::env::current_exe()?.canonicalize()?;
    let Some(dir) = exe.parent() else { bail!("cannot tell where nuphos is installed") };
    println!("Updating nuphos {current} → {latest}");
    let status = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!(
            "curl -fsSL https://raw.githubusercontent.com/nuphos/nuphos/cli-v{latest}/apps/cli/install.sh | sh"
        ))
        .env("NUPHOS_INSTALL_DIR", dir)
        .env("NUPHOS_VERSION", &latest)
        .status()?;
    Ok(status.code().unwrap_or(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(parse("0.10.2"), Some((0, 10, 2)));
        assert!(parse("1.2").is_none());
        assert!(is_newer("99.0.0"));
        assert!(!is_newer("0.0.1"));
        assert!(!is_newer("garbage"));
    }
}
