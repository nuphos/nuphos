//! `nuphos agent`: runs this computer's Claude Code and Codex as local agents
//! for Nuphos, as the desktop app does, without the app. The runtime (openab,
//! the ACP adapters and the desktop's host code) is a per-platform asset of
//! this CLI release, fetched on first use and run on the user's own Node.

use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use anyhow::{anyhow, bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::config;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const MIN_NODE: u64 = 22;

/// Replaces this process with the host, so Ctrl-C reaches it directly and
/// it can stop the agents before exiting.
pub async fn run() -> Result<i32> {
    let node = node()?;
    let runtime = match std::env::var_os("NUPHOS_LOCAL_RUNTIME_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => fetch().await?,
    };
    let error = Command::new(node)
        .arg(runtime.join("host.mjs"))
        .env("NUPHOS_LOCAL_RUNTIME_DIR", &runtime)
        .env("NUPHOS_API_URL", config::api_url())
        .env("NUPHOS_CLI_VERSION", VERSION)
        .exec();
    Err(error).context("could not start node")
}

fn node() -> Result<String> {
    let missing = || anyhow!("`nuphos agent` needs Node.js {MIN_NODE} or newer on PATH");
    let output = Command::new("node").arg("--version").output().map_err(|_| missing())?;
    let version = String::from_utf8_lossy(&output.stdout);
    let major: u64 = version.trim().trim_start_matches('v').split('.').next().and_then(|m| m.parse().ok()).unwrap_or(0);
    if major < MIN_NODE {
        bail!("{} (found {})", missing(), version.trim());
    }
    Ok("node".into())
}

fn platform() -> Result<&'static str> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        (os, arch) => bail!("no local agent runtime for {os} {arch}"),
    })
}

/// `~/.local/share/nuphos/runtime/<version>-<platform>`, downloaded once per
/// CLI version; older ones are removed once the new one is in place.
async fn fetch() -> Result<PathBuf> {
    let platform = platform()?;
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| anyhow!("HOME is not set"))?;
    let root = home.join(".local/share/nuphos/runtime");
    let dir = root.join(format!("{VERSION}-{platform}"));
    if dir.join("host.mjs").exists() {
        return Ok(dir);
    }

    let base = std::env::var("NUPHOS_DOWNLOAD_URL")
        .unwrap_or_else(|_| format!("https://github.com/nuphos/nuphos/releases/download/cli-v{VERSION}"));
    let asset = format!("nuphos-agent-{platform}.tar.gz");
    eprintln!("Downloading the local agent runtime for {platform}…");
    let http = reqwest::Client::new();
    let get = |url: String| {
        let http = http.clone();
        async move {
            let response = http.get(&url).send().await.and_then(|r| r.error_for_status());
            response.with_context(|| format!("could not download {url}"))?.bytes().await.context("download interrupted")
        }
    };
    let checksum = get(format!("{base}/{asset}.sha256")).await?;
    let archive = get(format!("{base}/{asset}")).await?;
    let expected = String::from_utf8_lossy(&checksum).split_whitespace().next().unwrap_or_default().to_string();
    let actual: String = Sha256::digest(&archive).iter().map(|b| format!("{b:02x}")).collect();
    if expected != actual {
        bail!("checksum mismatch for {asset}");
    }

    std::fs::create_dir_all(&root)?;
    let staging = root.join(format!(".{VERSION}-{platform}.{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;
    let file = staging.with_extension("tar.gz");
    std::fs::write(&file, &archive)?;
    let status = Command::new("tar").arg("-xzf").arg(&file).arg("-C").arg(&staging).status();
    let _ = std::fs::remove_file(&file);
    if !status.is_ok_and(|s| s.success()) {
        let _ = std::fs::remove_dir_all(&staging);
        bail!("could not unpack {asset}");
    }
    std::fs::rename(&staging, &dir)?;
    for old in std::fs::read_dir(&root)?.flatten() {
        if old.path() != dir {
            let _ = std::fs::remove_dir_all(old.path());
        }
    }
    Ok(dir)
}
