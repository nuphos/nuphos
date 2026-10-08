//! Choices the TUI and the non-interactive commands make the same way.

use anyhow::{bail, Result};
use serde_json::Value;

use crate::api::Api;
use crate::config::{self, Prefs};
use crate::render::clean;

/// `--team` (or `NUPHOS_TEAM`), the team used last time, then the first
/// team. Never asks: the TUI shows the team and `/team` switches it.
pub async fn resolve_team(api: &Api, prefs: &mut Prefs, wanted: Option<&str>) -> Result<Value> {
    let teams = api.teams().await?;
    if teams.is_empty() {
        bail!("You are not a member of any Nuphos team yet. Create one in the Nuphos app first.");
    }
    if let Some(name) = wanted {
        return find(&teams, name, "team");
    }
    let team =
        prefs.team_id.as_deref().and_then(|id| teams.iter().find(|t| t["id"] == id)).unwrap_or(&teams[0]).clone();
    remember_team(prefs, &team);
    Ok(team)
}

pub fn remember_team(prefs: &mut Prefs, team: &Value) {
    prefs.team_id = team["id"].as_str().map(String::from);
    config::write_prefs(prefs);
}

/// An item by id, or by name/label ignoring case.
pub fn find(items: &[Value], wanted: &str, what: &str) -> Result<Value> {
    let lower = wanted.to_lowercase();
    let matches = |v: &Value| {
        v["id"] == wanted || ["name", "label"].iter().any(|k| v[*k].as_str().is_some_and(|s| s.to_lowercase() == lower))
    };
    match items.iter().find(|v| matches(v)) {
        Some(item) => Ok(item.clone()),
        None => {
            let names: Vec<String> = items.iter().map(label).collect();
            bail!("No {what} named '{}'. Choose one of: {}", clean(wanted), names.join(", "))
        }
    }
}

pub fn label(item: &Value) -> String {
    clean(item["name"].as_str().or(item["label"].as_str()).or(item["provider"].as_str()).unwrap_or("?"))
}

pub fn active_runtimes(list: Vec<Value>) -> Vec<Value> {
    list.into_iter().filter(|r| r["status"] == "active").collect()
}

fn usable(runtime: &Value) -> bool {
    runtime["notReady"].is_null() || runtime["notReady"] == false
}

/// The last runtime picked in this team, else the desktop's default: the
/// first of my own computers, then the first Cloud agent.
pub fn default_runtime(runtimes: &[Value], prefs: &Prefs, team_id: &str, me_id: &str) -> Option<Value> {
    prefs
        .runtime_ids
        .get(team_id)
        .and_then(|id| runtimes.iter().find(|r| r["id"] == id.as_str()))
        .or_else(|| {
            runtimes.iter().filter(|r| usable(r)).find(|r| r["kind"] == "local" && r["local"]["ownerUserId"] == me_id)
        })
        .or_else(|| runtimes.iter().filter(|r| usable(r)).find(|r| r["kind"] != "local"))
        .cloned()
}

pub fn runtime_detail(runtime: &Value) -> String {
    let mut detail = if runtime["kind"] == "local" { "local" } else { "cloud" }.to_string();
    if !usable(runtime) {
        detail.push_str(" · not ready");
    }
    detail
}

/// Files can only follow a conversation to the same kind of Cloud agent;
/// anything else carries the transcript only.
pub fn move_mode(from: Option<&Value>, to: &Value) -> &'static str {
    let same = from.is_some_and(|r| r["provider"] == to["provider"] && r["kind"] != "local" && to["kind"] != "local");
    if same {
        "workspace"
    } else {
        "history"
    }
}

/// A model-config option (`{ id, name, kind, currentValue, options }`).
pub fn option_of_kind<'a>(config: &'a Value, kind: &str) -> Option<&'a Value> {
    config["options"].as_array()?.iter().find(|o| o["kind"] == kind)
}

pub fn current_name(option: &Value) -> Option<String> {
    let current = option["currentValue"].as_str()?;
    let name = option["options"]
        .as_array()
        .and_then(|values| values.iter().find(|v| v["value"] == current))
        .and_then(|v| v["name"].as_str())
        .unwrap_or(current);
    Some(name.to_string())
}

pub fn conversation_title(c: &Value) -> String {
    let title = c["title"].as_str().filter(|t| !t.is_empty()).or(c["firstMessage"].as_str()).unwrap_or("Untitled chat");
    clean(title.lines().next().unwrap_or_default()).chars().take(70).collect()
}

/// How long ago the conversation was last active: `5m ago`, `3h ago`, `2d ago`.
pub fn conversation_time(c: &Value) -> String {
    let Some(then) = c["lastActiveAt"].as_str().and_then(unix_seconds) else { return String::new() };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    match (now - then).max(0) {
        s if s < 60 => "just now".into(),
        s if s < 3600 => format!("{}m ago", s / 60),
        s if s < 86_400 => format!("{}h ago", s / 3600),
        s if s < 30 * 86_400 => format!("{}d ago", s / 86_400),
        s => format!("{}mo ago", s / (30 * 86_400)),
    }
}

/// `2026-10-08T09:41:05.869Z` as seconds since the epoch, UTC.
fn unix_seconds(t: &str) -> Option<i64> {
    let n = |r: std::ops::Range<usize>| t.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    // Days from civil, Howard Hinnant's algorithm.
    let (y, m) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + (153 * m + 2) / 5 + d - 1;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + n(11..13)? * 3600 + n(14..16)? * 60 + n(17..19)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso_times() {
        assert_eq!(unix_seconds("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(unix_seconds("2026-10-08T09:41:05.869Z"), Some(1_791_452_465));
        assert_eq!(unix_seconds("garbage"), None);
    }
}
