//! `nuphos agent`: runs this computer's Claude Code and Codex as local agents
//! for Nuphos, as the desktop app does, without the app. The runtime (openab,
//! the ACP adapters and the desktop's host code) is a per-platform asset of
//! this CLI release, fetched on first use and run on the user's own Node, or
//! on Node.js 22 fetched from nodejs.org when the computer has no new enough one.

use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::config;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const MIN_NODE: u64 = 22;

/// The join token from `--join`, `--join -` (stdin) or `NUPHOS_JOIN_TOKEN`.
pub fn join_token(arg: Option<&str>) -> Result<Option<String>> {
    let token = match arg {
        Some("-") => {
            let mut line = String::new();
            std::io::stdin().read_line(&mut line).context("could not read the join token")?;
            line
        }
        Some(token) => token.to_owned(),
        None => std::env::var("NUPHOS_JOIN_TOKEN").unwrap_or_default(),
    };
    let token = token.trim();
    Ok((!token.is_empty()).then(|| token.to_owned()))
}

/// Where the host keeps this computer's identity and credential; the host gets it as `NUPHOS_AGENT_HOME`.
fn agent_home() -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os("NUPHOS_AGENT_HOME") {
        return Ok(PathBuf::from(dir));
    }
    let home = std::env::var_os("HOME").context("HOME is not set")?;
    Ok(PathBuf::from(home).join(".local/share/nuphos/agent"))
}

/// Whether an earlier `--join` left this computer a credential. The host checks
/// it is still valid; this only decides whether to sign in first.
pub fn joined() -> bool {
    agent_home().is_ok_and(|dir| dir.join("device-credential.json").is_file())
}

/// Replaces this process with the host, so Ctrl-C reaches it directly and
/// it can stop the agents before exiting.
pub async fn run(join: Option<String>) -> Result<i32> {
    let (node, node_bin) = node().await?;
    let runtime = match std::env::var_os("NUPHOS_LOCAL_RUNTIME_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => fetch().await?,
    };
    let mut host = Command::new(node);
    if let Some(bin) = node_bin {
        // Agent CLIs installed with npm start through `env node`, so they find it too.
        let path = std::env::var_os("PATH").unwrap_or_default();
        host.env("PATH", std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(&path)))?);
    }
    if let Some(token) = join {
        host.env("NUPHOS_JOIN_TOKEN", token);
    }
    // The session for a host on plain Node, which cannot read the keychain;
    // it drops the variable at once so the agents it starts never see it.
    if let Some(token) = config::read_session().token {
        host.env("NUPHOS_SESSION_TOKEN", token);
    }
    let error = host
        .arg(runtime.join("host.mjs"))
        .env("NUPHOS_AGENT_HOME", agent_home()?)
        .env("NUPHOS_LOCAL_RUNTIME_DIR", &runtime)
        .env("NUPHOS_API_URL", config::api_url())
        .env("NUPHOS_CLI_VERSION", VERSION)
        .exec();
    Err(error).context("could not start node")
}

/// Node.js 22 LTS from the official builds, for a computer without a new enough Node.js.
const NODE_DIST: &str = "https://nodejs.org/dist/latest-v22.x";

/// The Node.js on PATH when it is new enough. Otherwise Node.js 22 LTS kept in
/// `~/.local/share/nuphos/node`, fetched once and checked against the release's
/// SHASUMS256.txt, with its bin directory to put first on the host's PATH.
async fn node() -> Result<(PathBuf, Option<PathBuf>)> {
    let Err(missing) = system_node() else {
        return Ok(("node".into(), None));
    };
    let root = data_dir()?.join("node");
    let dir = match fetched_node(&root) {
        Some(dir) => dir,
        None => {
            let platform = platform()?;
            eprintln!("{missing}; downloading Node.js {MIN_NODE} for {platform} from nodejs.org…");
            let sums = get(format!("{NODE_DIST}/SHASUMS256.txt")).await?;
            let (sum, asset) = node_asset(&String::from_utf8_lossy(&sums), platform)
                .ok_or_else(|| anyhow!("no Node.js {MIN_NODE} build for {platform} at {NODE_DIST}"))?;
            let archive = get(format!("{NODE_DIST}/{asset}")).await?;
            let dir = root.join(asset.trim_end_matches(".tar.gz"));
            // The archive holds one node-v…-<platform> folder.
            unpack(&archive, &sum, &asset, &root, &dir, &["--strip-components=1"])?;
            dir
        }
    };
    let bin = dir.join("bin");
    Ok((bin.join("node"), Some(bin)))
}

/// A Node.js fetched earlier, never a `.`-named staging folder a stopped download left behind.
fn fetched_node(root: &Path) -> Option<PathBuf> {
    std::fs::read_dir(root).ok()?.flatten().find_map(|entry| {
        let finished = !entry.file_name().to_string_lossy().starts_with('.');
        (finished && entry.path().join("bin/node").is_file()).then(|| entry.path())
    })
}

/// Whether `node` on PATH is Node.js 22 or newer; the error says what is missing.
fn system_node() -> Result<()> {
    let missing = || anyhow!("`nuphos agent` needs Node.js {MIN_NODE} or newer on PATH");
    let output = Command::new("node").arg("--version").output().map_err(|_| missing())?;
    let version = String::from_utf8_lossy(&output.stdout);
    let major: u64 = version.trim().trim_start_matches('v').split('.').next().and_then(|m| m.parse().ok()).unwrap_or(0);
    if major < MIN_NODE {
        bail!("{} (found {})", missing(), version.trim());
    }
    Ok(())
}

/// The checksum and file name of this platform's `.tar.gz` in a Node.js SHASUMS256.txt.
fn node_asset(sums: &str, platform: &str) -> Option<(String, String)> {
    sums.lines().find_map(|line| {
        let (sum, name) = line.split_once(char::is_whitespace)?;
        let name = name.trim();
        (name.starts_with("node-v") && name.ends_with(&format!("-{platform}.tar.gz")))
            .then(|| (sum.to_owned(), name.to_owned()))
    })
}

fn platform() -> Result<&'static str> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        (os, arch) => bail!("no local runtime for {os} {arch}"),
    })
}

fn data_dir() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| anyhow!("HOME is not set"))?;
    Ok(home.join(".local/share/nuphos"))
}

/// `~/.local/share/nuphos/runtime/<version>-<platform>`, downloaded once per
/// CLI version; older ones are removed once the new one is in place.
async fn fetch() -> Result<PathBuf> {
    let platform = platform()?;
    let root = data_dir()?.join("runtime");
    let dir = root.join(format!("{VERSION}-{platform}"));
    if dir.join("host.mjs").exists() {
        return Ok(dir);
    }

    let base = std::env::var("NUPHOS_DOWNLOAD_URL")
        .unwrap_or_else(|_| format!("https://github.com/nuphos/nuphos/releases/download/cli-v{VERSION}"));
    let asset = format!("nuphos-agent-{platform}.tar.gz");
    eprintln!("Downloading the local runtime for {platform}…");
    let checksum = get(format!("{base}/{asset}.sha256")).await?;
    let archive = get(format!("{base}/{asset}")).await?;
    let expected = String::from_utf8_lossy(&checksum).split_whitespace().next().unwrap_or_default().to_string();
    unpack(&archive, &expected, &asset, &root, &dir, &[])?;
    Ok(dir)
}

async fn get(url: String) -> Result<Vec<u8>> {
    let response = reqwest::get(&url).await.and_then(|r| r.error_for_status());
    let bytes = response.with_context(|| format!("could not download {url}"))?.bytes().await;
    Ok(bytes.context("download interrupted")?.to_vec())
}

/// Checks `archive` against its SHA-256, unpacks it to `dir` under `root` and
/// removes whatever else `root` held, an older version among it.
fn unpack(archive: &[u8], expected: &str, asset: &str, root: &Path, dir: &Path, tar_args: &[&str]) -> Result<()> {
    let actual: String = Sha256::digest(archive).iter().map(|b| format!("{b:02x}")).collect();
    if expected != actual {
        bail!("checksum mismatch for {asset}");
    }

    std::fs::create_dir_all(root)?;
    let staging =
        root.join(format!(".{}.{}", dir.file_name().unwrap_or_default().to_string_lossy(), std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;
    let file = staging.with_extension("tar.gz");
    std::fs::write(&file, archive)?;
    let status = Command::new("tar").arg("-xzf").arg(&file).arg("-C").arg(&staging).args(tar_args).status();
    let _ = std::fs::remove_file(&file);
    if !status.is_ok_and(|s| s.success()) {
        let _ = std::fs::remove_dir_all(&staging);
        bail!("could not unpack {asset}");
    }
    std::fs::rename(&staging, dir)?;
    for old in std::fs::read_dir(root)?.flatten() {
        if old.path() != dir {
            let _ = std::fs::remove_dir_all(old.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{fetched_node, node_asset};

    const SUMS: &str = "\
1111  node-v22.21.1-darwin-arm64.tar.gz
2222  node-v22.21.1-darwin-arm64.tar.xz
3333  node-v22.21.1-linux-x64.tar.xz
4444  node-v22.21.1-linux-x64.tar.gz
5555  node-v22.21.1-linux-x64-musl.tar.gz
6666  node-v22.21.1-win-x64.zip
";

    #[test]
    fn picks_this_platforms_tar_gz() {
        assert_eq!(node_asset(SUMS, "linux-x64"), Some(("4444".into(), "node-v22.21.1-linux-x64.tar.gz".into())));
        assert_eq!(node_asset(SUMS, "darwin-arm64"), Some(("1111".into(), "node-v22.21.1-darwin-arm64.tar.gz".into())));
        assert_eq!(node_asset(SUMS, "linux-arm64"), None);
    }

    #[test]
    fn skips_a_staging_folder_a_stopped_download_left() {
        let root = std::env::temp_dir().join(format!("nuphos-node-test-{}", std::process::id()));
        let staging = root.join(".node-v22.21.1-linux-x64.123");
        std::fs::create_dir_all(staging.join("bin")).unwrap();
        std::fs::write(staging.join("bin/node"), "").unwrap();
        assert_eq!(fetched_node(&root), None);

        let done = root.join("node-v22.21.1-linux-x64");
        std::fs::create_dir_all(done.join("bin")).unwrap();
        std::fs::write(done.join("bin/node"), "").unwrap();
        assert_eq!(fetched_node(&root), Some(done));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
