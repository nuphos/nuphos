//! Turns transcript parts into styled terminal lines. Markdown is rendered a
//! line at a time, so a reply can be written out as each line completes.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;
use unicode_width::UnicodeWidthChar;

use crate::transcript::{tool_name, tool_state};

pub fn dim() -> Style {
    Style::default().fg(Color::DarkGray)
}

/// Line-by-line markdown. Fenced code needs state across lines.
#[derive(Default, Clone)]
pub struct Markdown {
    in_code: bool,
}

impl Markdown {
    pub fn line(&mut self, raw: &str) -> Option<Line<'static>> {
        let trimmed = raw.trim_start();
        if trimmed.starts_with("```") {
            self.in_code = !self.in_code;
            return None;
        }
        if self.in_code {
            return Some(Line::from(Span::styled(format!("  {raw}"), Style::default().fg(Color::Cyan))));
        }
        let indent = &raw[..raw.len() - trimmed.len()];
        if let Some(rest) = trimmed.strip_prefix('#') {
            let text = rest.trim_start_matches('#').trim();
            return Some(Line::from(Span::styled(text.to_string(), Style::default().add_modifier(Modifier::BOLD))));
        }
        if let Some(rest) = trimmed.strip_prefix("> ") {
            let mut spans = vec![Span::styled("│ ", dim())];
            spans.extend(inline(rest).into_iter().map(|s| s.patch_style(dim())));
            return Some(Line::from(spans));
        }
        for bullet in ["- ", "* ", "+ "] {
            if let Some(rest) = trimmed.strip_prefix(bullet) {
                let mut spans = vec![Span::raw(format!("{indent}• "))];
                spans.extend(inline(rest));
                return Some(Line::from(spans));
            }
        }
        let mut spans = vec![Span::raw(indent.to_string())];
        spans.extend(inline(trimmed));
        Some(Line::from(spans))
    }
}

/// `code` and **bold**; everything else is shown as written.
fn inline(text: &str) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let tick = rest.find('`');
        let bold = rest.find("**");
        let (at, marker, style) = match (tick, bold) {
            (Some(t), Some(b)) if b < t => (b, "**", Style::default().add_modifier(Modifier::BOLD)),
            (Some(t), _) => (t, "`", Style::default().fg(Color::Cyan)),
            (None, Some(b)) => (b, "**", Style::default().add_modifier(Modifier::BOLD)),
            (None, None) => break,
        };
        let after = &rest[at + marker.len()..];
        let Some(end) = after.find(marker) else { break };
        if at > 0 {
            spans.push(Span::raw(rest[..at].to_string()));
        }
        spans.push(Span::styled(after[..end].to_string(), style));
        rest = &after[end + marker.len()..];
    }
    if !rest.is_empty() {
        spans.push(Span::raw(rest.to_string()));
    }
    spans
}

pub fn user(text: &str) -> Vec<Line<'static>> {
    let mut lines = vec![Line::default()];
    for (i, l) in text.lines().enumerate() {
        let prefix = if i == 0 { "› " } else { "  " };
        lines.push(Line::from(vec![
            Span::styled(prefix, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::styled(l.to_string(), Style::default().add_modifier(Modifier::BOLD)),
        ]));
    }
    lines.push(Line::default());
    lines
}

/// What the call does in one line: its command when it has one.
fn tool_summary(part: &Value) -> String {
    let input = &part["input"];
    let detail =
        ["command", "description", "query", "path", "url"].iter().find_map(|k| input[*k].as_str()).map(String::from);
    let title = part["title"].as_str().unwrap_or_else(|| tool_name(part));
    match detail {
        Some(d) if d != title => format!("{title}  {}", d.lines().next().unwrap_or_default()),
        _ => title.to_string(),
    }
}

fn output_text(output: &Value) -> String {
    match output {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        Value::Object(o) => ["stdout", "output", "text", "content", "result"]
            .iter()
            .find_map(|k| o.get(*k).and_then(Value::as_str))
            .map(String::from)
            .unwrap_or_else(|| output.to_string()),
        other => other.to_string(),
    }
}

/// A tool call as Codex shows one: a bullet, the call, and a few output lines.
pub fn tool(part: &Value) -> Vec<Line<'static>> {
    let state = tool_state(part);
    let (mark, color) = match state {
        "output-available" => ("✓", Color::Green),
        "output-error" => ("✗", Color::Red),
        "output-denied" => ("⊘", Color::Red),
        "approval-requested" => ("?", Color::Yellow),
        _ => ("•", Color::Yellow),
    };
    let mut lines = vec![Line::from(vec![
        Span::styled(format!("{mark} "), Style::default().fg(color).add_modifier(Modifier::BOLD)),
        Span::styled(tool_summary(part), Style::default().add_modifier(Modifier::BOLD)),
    ])];
    let detail = match state {
        "output-error" => part["errorText"].as_str().unwrap_or("failed").to_string(),
        "output-denied" => "denied".to_string(),
        _ => output_text(&part["output"]),
    };
    let detail_lines: Vec<&str> = detail.lines().filter(|l| !l.trim().is_empty()).collect();
    for (i, l) in detail_lines.iter().take(4).enumerate() {
        let prefix = if i == 0 { "  └ " } else { "    " };
        lines.push(Line::from(Span::styled(format!("{prefix}{l}"), dim())));
    }
    if detail_lines.len() > 4 {
        lines.push(Line::from(Span::styled(format!("    … +{} lines", detail_lines.len() - 4), dim())));
    }
    lines
}

/// Wraps styled lines to `width` columns, keeping styles.
pub fn wrap(lines: &[Line<'static>], width: u16) -> Vec<Line<'static>> {
    let width = width.max(10) as usize;
    let mut out = Vec::new();
    for line in lines {
        let mut current: Vec<Span<'static>> = Vec::new();
        let mut used = 0;
        for span in &line.spans {
            let mut chunk = String::new();
            for ch in span.content.chars() {
                let w = ch.width().unwrap_or(0);
                if used + w > width {
                    if !chunk.is_empty() {
                        current.push(Span::styled(std::mem::take(&mut chunk), span.style));
                    }
                    out.push(Line::from(std::mem::take(&mut current)));
                    used = 0;
                }
                chunk.push(ch);
                used += w;
            }
            if !chunk.is_empty() {
                current.push(Span::styled(chunk, span.style));
            }
        }
        out.push(Line::from(current));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(line: &Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    #[test]
    fn fences_are_hidden_and_code_is_indented() {
        let mut md = Markdown::default();
        assert!(md.line("```bash").is_none());
        assert_eq!(text(&md.line("ls -la").unwrap()), "  ls -la");
        assert!(md.line("```").is_none());
        assert_eq!(text(&md.line("- **a** `b`").unwrap()), "• a b");
    }

    #[test]
    fn wrap_counts_wide_characters() {
        let lines = wrap(&[Line::from("一二三四五六")], 10);
        assert_eq!(lines.len(), 2);
        assert_eq!(text(&lines[0]), "一二三四五");
    }
}
