//! Container resource usage reported by `_openab/runtime/state`: cgroup v2 first, `/proc`
//! when the process is not in a cgroup of its own. Any figure that cannot be read is `null`.

use parking_lot::Mutex;
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};

const CGROUP_ROOT: &str = "/sys/fs/cgroup";
const PROC_ROOT: &str = "/proc";
/// Reads closer together than this (two backend replicas sampling on the same tick) reuse
/// the previous rate instead of dividing by a near-zero window.
const MIN_CPU_WINDOW: Duration = Duration::from_secs(1);
const MAX_CPU_WINDOW: Duration = Duration::from_secs(300);

struct CpuReading {
    at: Instant,
    usage_usec: u64,
    millicores: Option<u64>,
}

static LAST_CPU: Mutex<Option<CpuReading>> = parking_lot::const_mutex(None);

/// Off the async worker: a configured network or FUSE mount can stall `statvfs`.
pub async fn snapshot(disk_paths: Vec<String>) -> Value {
    tokio::task::spawn_blocking(move || read_snapshot(&disk_paths))
        .await
        .unwrap_or_else(|_| {
            json!({
                "cpuMillicores": null,
                "memoryBytes": null,
                "diskUsedBytes": null,
                "diskTotalBytes": null,
            })
        })
}

fn read_snapshot(disk_paths: &[String]) -> Value {
    let cgroup = Path::new(CGROUP_ROOT);
    let proc = Path::new(PROC_ROOT);
    let millicores = cpu_usage_usec(cgroup, proc)
        .and_then(|usage| cpu_millicores(&mut LAST_CPU.lock(), usage, Instant::now()));
    let disk = disk_usage(disk_paths);
    json!({
        "cpuMillicores": millicores,
        "memoryBytes": memory_bytes(cgroup, proc),
        "diskUsedBytes": disk.map(|(used, _)| used),
        "diskTotalBytes": disk.map(|(_, total)| total),
    })
}

fn read(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn keyed(text: &str, key: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        (fields.next()? == key).then(|| fields.next()?.parse().ok())?
    })
}

fn cpu_usage_usec(cgroup: &Path, proc: &Path) -> Option<u64> {
    if let Some(usage) = read(&cgroup.join("cpu.stat")).and_then(|s| keyed(&s, "usage_usec")) {
        return Some(usage);
    }
    let stat = read(&proc.join("stat"))?;
    let fields: Vec<u64> = stat
        .lines()
        .find(|line| line.starts_with("cpu "))?
        .split_whitespace()
        .skip(1)
        .filter_map(|v| v.parse().ok())
        .collect();
    // user nice system idle iowait irq softirq steal: everything but idle and iowait.
    let busy: u64 = fields
        .iter()
        .take(8)
        .enumerate()
        .filter(|(i, _)| *i != 3 && *i != 4)
        .map(|(_, v)| v)
        .sum();
    Some(busy.saturating_mul(1_000_000) / clock_ticks_per_second())
}

fn clock_ticks_per_second() -> u64 {
    #[cfg(unix)]
    {
        let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
        if ticks > 0 {
            return ticks as u64;
        }
    }
    100
}

fn cpu_millicores(last: &mut Option<CpuReading>, usage_usec: u64, now: Instant) -> Option<u64> {
    if let Some(prev) = last.as_ref() {
        if now.duration_since(prev.at) < MIN_CPU_WINDOW {
            return prev.millicores;
        }
    }
    let millicores = last.as_ref().and_then(|prev| {
        let window = now.duration_since(prev.at);
        let used = usage_usec.checked_sub(prev.usage_usec)?;
        (window <= MAX_CPU_WINDOW).then(|| (used as u128 * 1000 / window.as_micros().max(1)) as u64)
    });
    *last = Some(CpuReading {
        at: now,
        usage_usec,
        millicores,
    });
    millicores
}

/// Working set, as the kubelet counts it: usage minus reclaimable inactive page cache.
fn memory_bytes(cgroup: &Path, proc: &Path) -> Option<u64> {
    if let Some(current) = read(&cgroup.join("memory.current")).and_then(|s| s.trim().parse().ok())
    {
        let inactive = read(&cgroup.join("memory.stat"))
            .and_then(|s| keyed(&s, "inactive_file"))
            .unwrap_or(0);
        return Some(u64::saturating_sub(current, inactive));
    }
    let meminfo = read(&proc.join("meminfo"))?;
    let total = keyed(&meminfo, "MemTotal:")?;
    let available = keyed(&meminfo, "MemAvailable:")?;
    Some(total.saturating_sub(available) * 1024)
}

/// Used and total bytes across the listed paths, each filesystem counted once.
fn disk_usage(paths: &[String]) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let mut seen = std::collections::HashSet::new();
        let mut totals: Option<(u64, u64)> = None;
        for path in paths {
            let Ok(meta) = std::fs::metadata(path) else {
                continue;
            };
            if !seen.insert(meta.dev()) {
                continue;
            }
            let Some((used, total)) = statvfs(path) else {
                continue;
            };
            let (u, t) = totals.unwrap_or((0, 0));
            totals = Some((u + used, t + total));
        }
        totals
    }
    #[cfg(not(unix))]
    {
        let _ = paths;
        None
    }
}

#[cfg(unix)]
fn statvfs(path: &str) -> Option<(u64, u64)> {
    let c_path = std::ffi::CString::new(path).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    let block = stat.f_frsize as u64;
    let total = stat.f_blocks as u64 * block;
    let free = stat.f_bfree as u64 * block;
    Some((total.saturating_sub(free), total))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(files: &[(&str, &str)]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("openab-usage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        for (name, body) in files {
            std::fs::write(dir.join(name), body).unwrap();
        }
        dir
    }

    #[test]
    fn cpu_is_the_average_rate_between_reads() {
        let mut last = None;
        let start = Instant::now();
        assert_eq!(cpu_millicores(&mut last, 1_000_000, start), None);
        // 1.5 CPU-seconds over 3 seconds is half a core.
        let later = start + Duration::from_secs(3);
        assert_eq!(cpu_millicores(&mut last, 2_500_000, later), Some(500));
        // A second reader inside the minimum window sees the same rate.
        let racing = later + Duration::from_millis(50);
        assert_eq!(cpu_millicores(&mut last, 2_500_100, racing), Some(500));
    }

    #[test]
    fn cpu_restarts_after_a_long_gap_or_a_counter_reset() {
        let mut last = None;
        let start = Instant::now();
        cpu_millicores(&mut last, 5_000_000, start);
        assert_eq!(
            cpu_millicores(&mut last, 9_000_000, start + Duration::from_secs(600)),
            None
        );
        assert_eq!(
            cpu_millicores(&mut last, 10, start + Duration::from_secs(630)),
            None
        );
    }

    #[test]
    fn cgroup_usage_wins_over_proc() {
        let cgroup = fixture(&[
            ("cpu.stat", "usage_usec 4200\nuser_usec 4000\n"),
            ("memory.current", "1048576\n"),
            (
                "memory.stat",
                "anon 10\ninactive_file 4096\nactive_file 1\n",
            ),
        ]);
        let proc = fixture(&[]);
        assert_eq!(cpu_usage_usec(&cgroup, &proc), Some(4200));
        assert_eq!(memory_bytes(&cgroup, &proc), Some(1048576 - 4096));
    }

    #[test]
    fn proc_is_the_fallback_outside_a_cgroup() {
        let cgroup = fixture(&[]);
        let proc = fixture(&[
            (
                "stat",
                "cpu  100 0 50 9000 30 0 0 0 0 0\ncpu0 100 0 50 9000 30 0 0 0 0 0\n",
            ),
            (
                "meminfo",
                "MemTotal:       2000 kB\nMemFree: 100 kB\nMemAvailable:    500 kB\n",
            ),
        ]);
        assert_eq!(
            cpu_usage_usec(&cgroup, &proc),
            Some(150 * 1_000_000 / clock_ticks_per_second())
        );
        assert_eq!(memory_bytes(&cgroup, &proc), Some(1500 * 1024));
    }

    #[test]
    fn nothing_readable_is_unknown() {
        let empty = fixture(&[]);
        assert_eq!(cpu_usage_usec(&empty, &empty), None);
        assert_eq!(memory_bytes(&empty, &empty), None);
        assert_eq!(disk_usage(&[]), None);
        assert_eq!(disk_usage(&["/definitely/not/here".into()]), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_filesystem_listed_twice_is_counted_once() {
        let dir = fixture(&[]).display().to_string();
        let (used, total) = disk_usage(std::slice::from_ref(&dir)).unwrap();
        assert!(total > 0 && used <= total);
        assert_eq!(disk_usage(&[dir.clone(), dir]).unwrap().1, total);
    }
}
