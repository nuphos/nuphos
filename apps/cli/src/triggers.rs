//! `nuphos triggers`: the team's schedules and webhooks with their last and
//! next run, and what a trigger spent.

use anyhow::{bail, Result};
use serde_json::Value;

use crate::cli::Ctx;
use crate::render::clean;
use crate::shared::{self, label};

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// `nuphos triggers [list]`: one row per trigger.
pub async fn list(ctx: &Ctx) -> Result<()> {
    let triggers = ctx.api.triggers(&ctx.team_id()).await?;
    if ctx.json {
        ctx.print_json(&Value::Array(triggers));
        return Ok(());
    }
    if triggers.is_empty() {
        println!("No triggers.");
    }
    let now = now();
    for t in &triggers {
        println!("{}", list_row(t, now));
    }
    Ok(())
}

/// `nuphos triggers usage TRIGGER`: the last 7 days of spend.
pub async fn usage(ctx: &Ctx, wanted: &str) -> Result<()> {
    let team = ctx.team_id();
    let trigger = if is_id(wanted) {
        ctx.api.trigger(&team, wanted).await?
    } else {
        pick(&ctx.api.triggers(&team).await?, wanted)?
    };
    let usage = ctx.api.trigger_usage(&team, trigger["id"].as_str().unwrap_or(wanted)).await?;
    if ctx.json {
        ctx.print_json(&usage);
    } else {
        println!("{}", usage_text(&label(&trigger), &usage));
    }
    Ok(())
}

/// A trigger id is a 24-character hex string.
fn is_id(s: &str) -> bool {
    s.len() == 24 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The trigger called `wanted` (ignoring case); a name two triggers share is an error.
fn pick(triggers: &[Value], wanted: &str) -> Result<Value> {
    let lower = wanted.to_lowercase();
    let same: Vec<&Value> =
        triggers.iter().filter(|t| t["name"].as_str().is_some_and(|n| n.to_lowercase() == lower)).collect();
    if same.len() > 1 {
        let ids: Vec<String> = same.iter().map(|t| clean(t["id"].as_str().unwrap_or("?"))).collect();
        bail!("{} triggers are named '{}'. Use an id: {}", same.len(), clean(wanted), ids.join(", "));
    }
    shared::find(triggers, wanted, "trigger")
}

/// `name  schedule  ran 5m ago  next in 3h  id`.
fn list_row(t: &Value, now: i64) -> String {
    let next = match t["nextRunAt"].as_str() {
        _ if t["enabled"].as_bool() != Some(true) => "disabled".to_string(),
        Some(at) => format!("next {}", relative(at, now)),
        None => "next —".to_string(),
    };
    let ran = match t["lastRunAt"].as_str() {
        Some(at) => format!("ran {}", relative(at, now)),
        None => "never run".to_string(),
    };
    [label(t), schedule(t), ran, next, clean(t["id"].as_str().unwrap_or_default())].join("  ")
}

fn schedule(t: &Value) -> String {
    let text = |k: &str| t[k].as_str().filter(|s| !s.is_empty()).map(clean);
    if let Some(described) = text("scheduleDescription") {
        return described;
    }
    match (text("cronExpression"), text("timeZone")) {
        (Some(cron), Some(zone)) => format!("{cron} {zone}"),
        (Some(cron), None) => cron,
        _ => "webhook".to_string(),
    }
}

/// `5m ago`, `just now`, `in 3h` or `in <1m` for an ISO time, measured from
/// `now` and rounded to the nearest minute, hour or day.
fn relative(at: &str, now: i64) -> String {
    let Some(then) = shared::unix_seconds(at) else { return "?".to_string() };
    let span = |s: i64| match s {
        s if s < 3570 => format!("{}m", (s + 30) / 60),
        s if s < 84_600 => format!("{}h", (s + 1800) / 3600),
        s => format!("{}d", (s + 43_200) / 86_400),
    };
    match then - now {
        s if s > 0 && s < 60 => "in <1m".to_string(),
        s if s > 0 => format!("in {}", span(s)),
        s if s > -60 => "just now".to_string(),
        s => format!("{} ago", span(-s)),
    }
}

/// Per-fire lines print only when the backend reports per-run usage (`fires`);
/// otherwise usage is per conversation, where one bound conversation
/// accumulates several fires.
fn usage_text(name: &str, usage: &Value) -> String {
    let totals = &usage["totals"];
    let mut lines = vec![
        format!("{name}: usage since {}", clean(usage["since"].as_str().unwrap_or("?"))),
        format!("  tokens  {}", tokens(totals)),
        format!("  turns   {}", totals["turns"].as_u64().unwrap_or(0)),
        format!("  cost    {}", cost(totals)),
    ];
    let (heading, key, items) = match usage["fires"].as_array() {
        Some(fires) => ("Per fire", "fireId", fires.as_slice()),
        None => ("Per conversation", "sessionId", usage["sessions"].as_array().map_or(&[][..], |s| s.as_slice())),
    };
    if !items.is_empty() {
        lines.push(String::new());
        lines.push(format!("{heading}:"));
    }
    for item in items {
        let id = clean(item[key].as_str().unwrap_or("?"));
        lines.push(format!(
            "  {id}  {} turns  {} tokens  {}",
            item["turns"].as_u64().unwrap_or(0),
            item["totalTokens"].as_u64().unwrap_or(0),
            cost(item)
        ));
    }
    lines.join("\n")
}

fn tokens(totals: &Value) -> String {
    let n = |k: &str| totals[k].as_u64().unwrap_or(0);
    format!(
        "input {}, cache read {}, cache write {}, output {} (total {})",
        n("inputTokens"),
        n("cachedInputTokens"),
        n("cacheWriteTokens"),
        n("outputTokens"),
        n("totalTokens")
    )
}

/// Dollars, with 2 decimals, or 4 when a few cents would be rounded away.
fn cost(totals: &Value) -> String {
    match totals["costUsd"].as_f64() {
        Some(usd) if usd == 0.0 || usd >= 0.1 => format!("${usd:.2}"),
        Some(usd) => format!("${usd:.4}"),
        None => "no price known".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NOW: i64 = 1_791_452_465; // 2026-10-08T09:41:05Z

    #[test]
    fn lists_a_cron_a_disabled_and_a_webhook_trigger() {
        let cron = json!({
            "id": "t1", "name": "Nightly report", "enabled": true, "triggerType": "cron",
            "scheduleDescription": "Every day at 02:00 (Europe/Stockholm)",
            "lastRunAt": "2026-10-08T06:41:05Z", "nextRunAt": "2026-10-08T12:41:05Z",
        });
        let off = json!({
            "id": "t2", "name": "Weekly", "enabled": false, "cronExpression": "0 9 * * 1",
            "timeZone": "UTC", "nextRunAt": null,
        });
        let hook = json!({ "id": "t3", "name": "On push", "enabled": true, "triggerType": "webhook" });
        assert_eq!(
            list_row(&cron, NOW),
            "Nightly report  Every day at 02:00 (Europe/Stockholm)  ran 3h ago  next in 3h  t1"
        );
        assert_eq!(list_row(&off, NOW), "Weekly  0 9 * * 1 UTC  never run  disabled  t2");
        assert_eq!(list_row(&hook, NOW), "On push  webhook  never run  next —  t3");
        let now = json!({ "id": "t4", "name": "Busy", "enabled": true, "lastRunAt": "2026-10-08T09:41:00Z" });
        assert_eq!(list_row(&now, NOW), "Busy  webhook  ran just now  next —  t4");
    }

    #[test]
    fn says_how_far_a_time_is() {
        assert_eq!(relative("2026-10-08T09:41:00Z", NOW), "just now");
        assert_eq!(relative("2026-10-08T09:11:05Z", NOW), "30m ago");
        assert_eq!(relative("2026-10-06T09:41:05Z", NOW), "2d ago");
        assert_eq!(relative("2026-10-08T09:41:35Z", NOW), "in <1m");
        assert_eq!(relative("2026-10-09T09:41:05Z", NOW), "in 1d");
        assert_eq!(relative("garbage", NOW), "?");
    }

    #[test]
    fn rounds_instead_of_truncating() {
        assert_eq!(relative("2026-10-08T07:42:05Z", NOW), "2h ago"); // 119 minutes
        assert_eq!(relative("2026-10-06T10:41:05Z", NOW), "2d ago"); // 47 hours
        assert_eq!(relative("2026-10-08T09:10:30Z", NOW), "31m ago"); // 30m35s
        assert_eq!(relative("2026-10-08T10:40:45Z", NOW), "in 1h"); // 59m40s
    }

    #[test]
    fn a_name_two_triggers_share_is_ambiguous() {
        let list = [
            json!({ "id": "a1", "name": "Report" }),
            json!({ "id": "b2", "name": "report" }),
            json!({ "id": "c3", "name": "Other" }),
        ];
        let err = pick(&list, "REPORT").unwrap_err().to_string();
        assert_eq!(err, "2 triggers are named 'REPORT'. Use an id: a1, b2");
        assert_eq!(pick(&list, "other").unwrap()["id"], "c3");
        assert_eq!(pick(&list, "c3").unwrap()["id"], "c3");
        assert!(pick(&list, "missing").is_err());
    }

    #[test]
    fn only_24_hex_characters_are_an_id() {
        assert!(is_id("65f1a2b3c4d5e6f708192a3b"));
        assert!(!is_id("65f1a2b3c4d5e6f708192a3"));
        assert!(!is_id("Nightly report 65f1a2b3c4d5"));
        assert!(!is_id("65f1a2b3c4d5e6f708192a3g"));
    }

    #[test]
    fn prices_cost_to_the_cent_or_finer() {
        assert_eq!(cost(&json!({ "costUsd": 12.3456 })), "$12.35");
        assert_eq!(cost(&json!({ "costUsd": 0.0421 })), "$0.0421");
        assert_eq!(cost(&json!({ "costUsd": 0.0042 })), "$0.0042");
        assert_eq!(cost(&json!({ "costUsd": 0 })), "$0.00");
        assert_eq!(cost(&json!({})), "no price known");
    }

    #[test]
    fn usage_lists_fires_when_present_else_conversations() {
        let mut usage = json!({
            "since": "2026-10-01T09:41:05Z",
            "totals": {
                "inputTokens": 100, "cachedInputTokens": 200, "cacheWriteTokens": 30,
                "outputTokens": 40, "totalTokens": 370, "turns": 3, "costUsd": 0.5,
            },
            "sessions": [{ "sessionId": "s1", "turns": 3, "totalTokens": 370 }],
        });
        let text = usage_text("Nightly", &usage);
        assert_eq!(
            text,
            "Nightly: usage since 2026-10-01T09:41:05Z\n  tokens  input 100, cache read 200, cache write 30, \
             output 40 (total 370)\n  turns   3\n  cost    $0.50\n\nPer conversation:\n  \
             s1  3 turns  370 tokens  no price known"
        );
        usage["fires"] = json!([{ "fireId": "f1", "sessionId": "s1", "turns": 2, "totalTokens": 300, "costUsd": 0.4 }]);
        assert!(usage_text("Nightly", &usage).ends_with("Per fire:\n  f1  2 turns  300 tokens  $0.40"));
    }
}
