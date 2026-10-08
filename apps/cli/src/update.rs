//! New releases: the TUI checks for one on start, and `nuphos update`
//! installs it by running the same script as the first install.

use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use serde_json::Value;

const RELEASES: &str = "https://api.github.com/repos/nuphos/nuphos/releases?per_page=50";
const INSTALLER: &str = "https://raw.githubusercontent.com/nuphos/nuphos/main/apps/cli/install.sh";

/// The newest published CLI version; other components share the repository.
pub async fn latest() -> Option<String> {
    let releases: Vec<Value> = reqwest::Client::new()
        .get(RELEASES)
        .header("user-agent", concat!("nuphos-cli/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    releases
        .iter()
        .filter(|r| r["draft"] != true && r["prerelease"] != true)
        .find_map(|r| r["tag_name"].as_str()?.strip_prefix("cli-v").map(String::from))
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
    let latest = latest().await.ok_or_else(|| anyhow!("could not find the newest release on GitHub"))?;
    if !is_newer(&latest) {
        println!("nuphos {current} is up to date.");
        return Ok(0);
    }
    let exe = std::env::current_exe()?.canonicalize()?;
    let Some(dir) = exe.parent() else { bail!("cannot tell where nuphos is installed") };
    println!("Updating nuphos {current} → {latest}");
    let status = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("curl -fsSL {INSTALLER} | sh"))
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
