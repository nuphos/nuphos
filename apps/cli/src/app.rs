//! The terminal UI. Like Codex, it takes over the whole screen (the
//! alternate screen): the conversation scrolls above a composer pinned to the
//! bottom. Alternate scroll mode makes the terminal send the mouse wheel as
//! ↑/↓, so the wheel scrolls while the terminal's own text selection still works.

use std::io::{stdout, Stdout};
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{
    DisableBracketedPaste, EnableBracketedPaste, Event, EventStream, KeyCode, KeyEvent, KeyEventKind, KeyModifiers,
};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use futures_util::{FutureExt, StreamExt};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Margin, Position, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Padding, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState};
use ratatui::{Frame, Terminal};
use serde_json::{json, Value};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::task::JoinHandle;
use unicode_width::UnicodeWidthStr;

use crate::api::{Api, ApiError, StreamEvent};
use crate::config::{self, Prefs};
use crate::render::{self, dim, Markdown};
use crate::shared::{self, current_name, option_of_kind};
use crate::transcript::{self as tx, is_tool, is_tool_settled, part_type, parts, role, tool_state};

/// Alternate scroll mode: in the alternate screen, the wheel arrives as ↑/↓.
const ALTERNATE_SCROLL_ON: &str = "\x1b[?1007h";
const ALTERNATE_SCROLL_OFF: &str = "\x1b[?1007l";
/// The Nuphos mark (apps/desktop/public/logo.svg) in braille, 14×7.
const LOGO: [&str; 7] = [
    "⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⠀⠀⠀⠀",
    "⠀⢀⣴⣶⣶⣶⣤⡀⠈⠻⣷⣄⠀⠀",
    "⣰⣿⠋⠁⠀⠉⠻⣿⣦⡀⠈⠻⣷⣄",
    "⣿⣇⠀⠠⣾⣦⡀⠈⠻⡿⠂⠀⢹⣿",
    "⠙⢿⣦⡀⠈⠻⣿⣦⡀⠀⢀⣠⣿⠏",
    "⠀⠀⠙⢿⣦⡀⠈⠛⠿⠿⠿⠛⠁⠀",
    "⠀⠀⠀⠀⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀",
];
const TIPS: [&str; 4] = [
    "Press ctrl+\\ to jump between your conversations.",
    "A reply keeps running on the server when you quit; `nuphos resume` picks it up.",
    "Use /runtime to run this conversation on another agent.",
    "Use /model to change the model and reasoning effort.",
];
const SPINNER: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const COMMANDS: [(&str, &str); 7] = [
    ("/model", "choose the model and reasoning effort"),
    ("/team", "switch to another team"),
    ("/runtime", "choose the agent this conversation runs on"),
    ("/new", "start a new conversation"),
    ("/resume", "continue a previous conversation"),
    ("/logout", "sign out of Nuphos here and in the desktop app"),
    ("/quit", "exit"),
];

type Term = Terminal<CrosstermBackend<Stdout>>;

/// How far the transcript has been written out above the viewport.
#[derive(Default)]
struct Cursor {
    msg: usize,
    part: usize,
    /// Bytes of the current text part already written.
    offset: usize,
    markdown: Markdown,
    last_was_tool: bool,
}

struct Stream {
    id: String,
    task: JoinHandle<()>,
}

enum PickAction {
    Team,
    Runtime,
    Conversation,
    /// A live conversation's model-config option (`model` or `effort`).
    SessionOption {
        config_id: String,
    },
    /// A new conversation: the runtime's default model, then its effort.
    DefaultModel,
    DefaultEffort {
        model: String,
    },
}

struct Picker {
    title: String,
    items: Vec<(String, String, Value)>,
    selected: usize,
    action: PickAction,
}

/// What the TUI opens with.
pub enum Start {
    New,
    /// A conversation by id, or the picker.
    Resume(Option<String>),
}

pub struct App {
    api: Api,
    prefs: Prefs,
    me_id: String,
    team: Value,
    runtimes: Vec<Value>,
    runtime: Option<Value>,
    model_label: Option<String>,

    session_id: String,
    /// No message sent yet: the conversation does not exist on the server.
    is_new: bool,
    messages: Vec<Value>,
    base_index: usize,
    assistant: Option<usize>,
    cursor: Cursor,

    stream: Option<Stream>,
    phase: Option<String>,
    stopping: bool,

    input: String,
    /// Cursor position in `input`, in chars.
    caret: usize,
    picker: Option<Picker>,
    notice: Option<String>,
    pending_output: Vec<Line<'static>>,
    /// Everything written out so far, and the same wrapped to `wrap_width`.
    history: Vec<Line<'static>>,
    wrapped: Vec<Line<'static>>,
    wrap_width: u16,
    /// Rows scrolled up from the bottom; 0 follows new output.
    scroll: usize,
    /// Rows the conversation took last frame, to hold a scrolled-up view still.
    rows: usize,
    /// Rows the conversation had on screen last frame.
    page: usize,
    tick: usize,
    quit: bool,
    /// Approvals whose full command has been written out.
    announced: Vec<String>,
    /// A newer release, shown as the welcome screen's tip.
    update: Option<String>,
    /// The conversation's title, for the top bar.
    title: Option<String>,
    /// The check for a newer release, started with the TUI.
    update_check: Option<JoinHandle<Option<String>>>,
    /// Streams of this conversation already followed to the end; the server
    /// can list one as running for a moment after it ends.
    ended: Vec<String>,

    tx: UnboundedSender<StreamEvent>,
    rx: UnboundedReceiver<StreamEvent>,
}

impl App {
    pub async fn new(api: Api, me_id: String, team: Value, prefs: Prefs) -> Result<Self> {
        let (tx, rx) = unbounded_channel();
        let mut app = App {
            api,
            prefs,
            me_id,
            team,
            runtimes: Vec::new(),
            runtime: None,
            model_label: None,
            session_id: String::new(),
            is_new: true,
            messages: Vec::new(),
            base_index: 0,
            assistant: None,
            cursor: Cursor::default(),
            stream: None,
            phase: None,
            stopping: false,
            input: String::new(),
            caret: 0,
            picker: None,
            notice: None,
            pending_output: Vec::new(),
            history: Vec::new(),
            wrapped: Vec::new(),
            wrap_width: 0,
            scroll: 0,
            rows: 0,
            page: 0,
            tick: 0,
            quit: false,
            announced: Vec::new(),
            ended: Vec::new(),
            update_check: None,
            update: None,
            title: None,
            tx,
            rx,
        };
        app.load_runtimes().await;
        app.new_conversation();
        Ok(app)
    }

    fn team_id(&self) -> String {
        self.team["id"].as_str().unwrap_or_default().to_string()
    }

    // MARK: - Run loop

    pub async fn run(mut self, start: Start) -> Result<Option<String>> {
        enable_raw_mode()?;
        execute!(stdout(), EnterAlternateScreen, EnableBracketedPaste, crossterm::style::Print(ALTERNATE_SCROLL_ON))?;
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            restore_terminal();
            hook(info);
        }));
        let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;

        if crate::update::check_enabled() {
            self.update_check = Some(tokio::spawn(crate::update::latest()));
        }
        match start {
            Start::New => {}
            Start::Resume(Some(id)) => self.resume(json!({ "sessionId": id })).await,
            Start::Resume(None) => self.open_conversation_picker().await,
        }

        let result = self.event_loop(&mut terminal).await;

        drop(terminal);
        restore_terminal();
        result?;
        Ok((!self.is_new).then(|| self.session_id.clone()))
    }

    fn take_update_check(&mut self) {
        if !self.update_check.as_ref().is_some_and(|h| h.is_finished()) {
            return;
        }
        let latest = self.update_check.take().and_then(|h| h.now_or_never()).and_then(|r| r.ok()).flatten();
        if let Some(version) = latest.filter(|v| crate::update::is_newer(v)) {
            self.update = Some(format!(
                "Update available: {} → {} · run `nuphos update`",
                env!("CARGO_PKG_VERSION"),
                render::clean(&version)
            ));
        }
    }

    async fn event_loop(&mut self, terminal: &mut Term) -> Result<()> {
        let mut events = EventStream::new();
        let mut ticker = tokio::time::interval(Duration::from_millis(120));
        let mut poller = tokio::time::interval(Duration::from_secs(3));
        while !self.quit {
            self.write_out(terminal)?;
            terminal.draw(|f| self.draw(f))?;
            tokio::select! {
                Some(event) = events.next() => {
                    match event? {
                        Event::Key(key) if key.kind != KeyEventKind::Release => self.on_key(key).await,
                        Event::Paste(text) => self.insert(&text.replace('\r', "")),
                        _ => {}
                    }
                }
                Some(event) = self.rx.recv() => self.on_stream(event).await,
                _ = ticker.tick() => {
                    self.tick = self.tick.wrapping_add(1);
                    self.take_update_check();
                }
                _ = poller.tick() => self.poll().await,
            }
        }
        Ok(())
    }

    /// Moves finished output into the history, wrapped to the screen width.
    fn write_out(&mut self, terminal: &mut Term) -> Result<()> {
        let force = self.stream.is_none();
        let mut lines = std::mem::take(&mut self.pending_output);
        lines.extend(self.take_finished(force));
        // A command waiting for approval is written out in full, however long.
        if let Some((mi, pi)) = self.pending_approval() {
            let part = &self.messages[mi]["parts"][pi];
            let id = part["approval"]["id"].as_str().or(part["toolCallId"].as_str()).unwrap_or_default().to_string();
            if !self.announced.contains(&id) {
                lines.extend(render::approval(part));
                self.announced.push(id);
            }
        }
        let width = terminal.size()?.width;
        if width != self.wrap_width {
            self.wrap_width = width;
            self.wrapped = render::wrap(&self.history, width);
        }
        self.wrapped.extend(render::wrap(&lines, width));
        self.history.extend(lines);
        Ok(())
    }

    // MARK: - Transcript output

    /// The transcript lines that are final, advancing the cursor past them.
    /// With `force` (no reply streaming) everything left is final except a
    /// call still waiting for approval.
    fn take_finished(&mut self, force: bool) -> Vec<Line<'static>> {
        let mut out = Vec::new();
        let c = &mut self.cursor;
        while c.msg < self.messages.len() {
            let message = &self.messages[c.msg];
            let mut blocked = false;
            if role(message) == "user" {
                if c.part == 0 {
                    out.extend(render::user(&message_text(message)));
                    c.part = 1;
                    c.last_was_tool = false;
                }
            } else {
                let parts = parts(message);
                while c.part < parts.len() {
                    let part = &parts[c.part];
                    match part_type(part) {
                        "text" => {
                            let text = part["text"].as_str().unwrap_or_default();
                            if c.offset > text.len() || !text.is_char_boundary(c.offset) {
                                // Being replayed and not caught up yet.
                                blocked = true;
                                break;
                            }
                            let done = force || part["state"] != "streaming";
                            let rest = &text[c.offset..];
                            let upto = if done { rest.len() } else { rest.rfind('\n').map_or(0, |i| i + 1) };
                            if upto > 0 && c.offset == 0 && c.last_was_tool {
                                out.push(Line::default());
                            }
                            out.extend(rest[..upto].lines().filter_map(|l| c.markdown.line(l)));
                            c.offset += upto;
                            if !done {
                                blocked = true;
                                break;
                            }
                            if !text.trim().is_empty() {
                                out.push(Line::default());
                                c.last_was_tool = false;
                            }
                            c.part += 1;
                            c.offset = 0;
                            c.markdown = Markdown::default();
                        }
                        "reasoning" if part["state"] == "streaming" && !force => {
                            blocked = true;
                            break;
                        }
                        _ if is_tool(part) => {
                            let waiting = tool_state(part) == "approval-requested";
                            if is_tool_settled(part) || (force && !waiting) {
                                out.extend(render::tool(part));
                                c.last_was_tool = true;
                                c.part += 1;
                            } else {
                                blocked = true;
                                break;
                            }
                        }
                        _ => c.part += 1,
                    }
                }
            }
            // The last message stays current: more parts may stream into it,
            // or a replay may rebuild it.
            if blocked || c.msg + 1 >= self.messages.len() {
                break;
            }
            c.msg += 1;
            c.part = 0;
            c.offset = 0;
            c.markdown = Markdown::default();
        }
        out
    }

    /// What has not been written out yet: the reply in progress.
    fn live_lines(&self) -> Vec<Line<'static>> {
        let mut out = Vec::new();
        let c = &self.cursor;
        for (mi, message) in self.messages.iter().enumerate().skip(c.msg) {
            if role(message) != "assistant" {
                continue;
            }
            let start = if mi == c.msg { c.part } else { 0 };
            for (pi, part) in parts(message).iter().enumerate().skip(start) {
                match part_type(part) {
                    "text" => {
                        let text = part["text"].as_str().unwrap_or_default();
                        let from = if mi == c.msg && pi == c.part { c.offset } else { 0 };
                        let mut markdown = if from > 0 { c.markdown.clone() } else { Markdown::default() };
                        if let Some(rest) = text.get(from..) {
                            out.extend(rest.lines().filter_map(|l| markdown.line(l)));
                        }
                    }
                    "reasoning" if part["state"] == "streaming" => {
                        let text = part["text"].as_str().unwrap_or_default();
                        let last = text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or_default();
                        out.push(Line::from(Span::styled(
                            format!("  {}", last.trim()),
                            dim().add_modifier(Modifier::ITALIC),
                        )));
                    }
                    // Written out in full above the prompt instead.
                    _ if is_tool(part) && tool_state(part) == "approval-requested" => {}
                    _ if is_tool(part) => out.extend(render::tool(part)),
                    _ => {}
                }
            }
        }
        out
    }

    fn pending_approval(&self) -> Option<(usize, usize)> {
        tx::pending_approval(&self.messages)
    }

    // MARK: - Drawing

    fn draw(&mut self, f: &mut Frame) {
        // Two columns of margin on each side, as Codex and Grok Build keep.
        let area = f.area().inner(Margin { horizontal: 2, vertical: 0 });
        if self.on_welcome() {
            return self.draw_welcome(f, area);
        }
        let input_lines = self.input.split('\n').count().clamp(1, 6) as u16;
        let sessions = matches!(self.picker, Some(Picker { action: PickAction::Conversation, .. }));
        let max_panel = if sessions { 0 } else { area.height / 2 };
        let panel = render::wrap(&self.panel_lines(max_panel as usize), area.width);
        let panel_height = (panel.len() as u16).min(max_panel);
        let [top, _, chat_area, panel_area, composer_area, footer] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(panel_height),
            Constraint::Length(input_lines + 2),
            Constraint::Length(1),
        ])
        .areas(area);
        self.draw_top_bar(f, top);
        if let Some(picker) = self.picker.as_ref().filter(|_| sessions) {
            f.render_widget(Paragraph::new(session_lines(picker, chat_area)), chat_area);
            self.draw_composer(f, composer_area);
            return f.render_widget(Paragraph::new(self.footer_hints(footer.width)), footer);
        }
        let text_area = Rect { width: chat_area.width.saturating_sub(2), ..chat_area };
        let lines = self.chat_lines(text_area.width, text_area.height as usize);
        f.render_widget(Paragraph::new(lines), text_area);
        if self.rows > self.page {
            let mut state = ScrollbarState::new(self.rows.saturating_sub(self.page))
                .position(self.rows.saturating_sub(self.page + self.scroll));
            let bar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(None)
                .end_symbol(None)
                .track_symbol(Some(" "))
                .thumb_symbol("┃");
            f.render_stateful_widget(bar.style(dim()), chat_area, &mut state);
        }
        f.render_widget(Paragraph::new(panel), panel_area);
        self.draw_composer(f, composer_area);
        f.render_widget(Paragraph::new(self.footer_hints(footer.width)), footer);
    }

    /// A new conversation before anything is typed.
    fn on_welcome(&self) -> bool {
        self.is_new && self.messages.is_empty() && self.input.is_empty() && self.picker.is_none()
    }

    /// Grok Build's home: the mark and the shortcuts in a box a third of the
    /// way down, a tip above the composer, and the endpoint in the corner.
    fn draw_welcome(&mut self, f: &mut Frame, area: Rect) {
        let bold = Style::default().add_modifier(Modifier::BOLD);
        let menu = [
            ("Sessions", "ctrl+\\"),
            ("Switch team", "/team"),
            ("Choose the agent", "/runtime"),
            ("Model and effort", "/model"),
            ("Quit", "ctrl+c"),
        ];
        let width = area.width.saturating_sub(4).min(120);
        // The mark goes when the box gets narrow; the menu needs the room.
        let mark = if width >= 70 { LOGO.len() as u16 } else { 0 };
        let mark_width = if mark > 0 { LOGO[0].chars().count() as u16 + 4 } else { 0 };
        let text_width = width.saturating_sub(mark_width + 6) as usize;
        let headline = match &self.update {
            Some(update) => Span::styled(
                update.clone(),
                Style::default().fg(Color::Rgb(255, 199, 119)).add_modifier(Modifier::BOLD),
            ),
            None => Span::styled(format!("{} · {}", shared::label(&self.team), self.agent_label()), dim()),
        };
        let mut text = vec![
            Line::from(vec![
                Span::styled("Nuphos", bold),
                Span::styled(format!("  {}", env!("CARGO_PKG_VERSION")), dim()),
            ]),
            Line::default(),
            Line::from(headline),
            Line::default(),
        ];
        for (label, key) in menu {
            let gap = text_width.saturating_sub(label.width() + key.width());
            text.push(Line::from(vec![
                Span::styled(label, bold),
                Span::raw(" ".repeat(gap)),
                Span::styled(key, dim()),
            ]));
        }
        let box_height = (text.len() as u16).max(mark) + 4;

        let [top, rest] = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).areas(area);
        f.render_widget(Span::styled(shared::label(&self.team), dim()), top);
        let below = 1 + 1 + 3 + 1 + 1 + 1;
        // Too short for the box: the composer matters more.
        if box_height + below <= rest.height {
            let slack = rest.height - box_height - below;
            let hero = Rect::new(area.x + (area.width - width) / 2, rest.y + 1 + slack / 3, width, box_height);
            let block = Block::bordered().border_type(BorderType::Rounded).border_style(dim());
            let inner = block.inner(hero).inner(Margin { horizontal: 2, vertical: 1 });
            f.render_widget(block, hero);
            let [logo, body] = Layout::horizontal([Constraint::Length(mark_width), Constraint::Min(0)]).areas(inner);
            let gray = Style::default().fg(Color::Gray).add_modifier(Modifier::DIM);
            f.render_widget(Paragraph::new(LOGO.map(|l| Line::from(Span::styled(l, gray))).to_vec()), logo);
            f.render_widget(Paragraph::new(text), body);
        }

        let [_, tip, _, composer, _, footer] = Layout::vertical([
            Constraint::Min(0),
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Length(3),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .areas(rest);
        let tip_line = match &self.notice {
            Some(text) => Line::from(Span::styled(text.clone(), Style::default().fg(Color::Yellow))),
            None => Line::from(vec![
                Span::styled("Tip: ", dim().add_modifier(Modifier::BOLD)),
                Span::styled(TIPS[self.session_id.len() % TIPS.len()], dim()),
            ]),
        };
        f.render_widget(Paragraph::new(tip_line), tip);
        self.draw_composer(f, composer);
        let host = config::api_url();
        let host = host.trim_start_matches("https://").trim_start_matches("http://");
        f.render_widget(Line::from(Span::styled(format!("[{}]", render::clean(host)), dim())).right_aligned(), footer);
    }

    fn agent_label(&self) -> String {
        let runtime = self.runtime.as_ref().and_then(|r| r["label"].as_str().or(r["provider"].as_str()));
        render::clean(runtime.unwrap_or("default agent"))
    }

    /// The conversation's title on the left, the team on the right.
    fn draw_top_bar(&self, f: &mut Frame, area: Rect) {
        let title = self.title.as_deref().unwrap_or("New conversation");
        let team = shared::label(&self.team);
        let room = (area.width as usize).saturating_sub(team.width() + 2);
        let title: String = render::clean(title).chars().take(room).collect();
        let gap = (area.width as usize).saturating_sub(title.width() + team.width());
        f.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(title, Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" ".repeat(gap)),
                Span::styled(team, dim()),
            ])),
            area,
        );
    }

    /// `❯` and the draft in a rounded box, with the agent and model set into
    /// its bottom border.
    fn draw_composer(&self, f: &mut Frame, area: Rect) {
        let label = format!(" {} · {} ", self.agent_label(), self.model_label.as_deref().unwrap_or("default model"));
        let block = Block::bordered()
            .border_type(BorderType::Rounded)
            .border_style(dim())
            .title_bottom(
                Line::from(vec![Span::styled(render::clean(&label), dim()), Span::styled("─", dim())]).right_aligned(),
            )
            .padding(Padding::horizontal(1));
        let inner = block.inner(area);
        f.render_widget(block, area);
        let [prompt, text] = Layout::horizontal([Constraint::Length(2), Constraint::Min(0)]).areas(inner);
        f.render_widget(Span::styled("❯", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)), prompt);
        if self.input.is_empty() {
            let placeholder = if self.is_new { "Ask Nuphos anything" } else { "Reply to Nuphos" };
            f.render_widget(Paragraph::new(Span::styled(placeholder, dim())), text);
        } else {
            let lines: Vec<&str> = self.input.split('\n').collect();
            let skip = lines.len().saturating_sub(text.height as usize);
            f.render_widget(Paragraph::new(lines[skip..].join("\n")), text);
        }
        if self.picker.is_none() {
            let before: String = self.input.chars().take(self.caret).collect();
            let row = before.matches('\n').count();
            let col = before.rsplit('\n').next().unwrap_or_default().width();
            let total = self.input.split('\n').count();
            let row = row.saturating_sub(total.saturating_sub(text.height as usize));
            f.set_cursor_position(Position::new(text.x + col as u16, text.y + row as u16));
        }
    }

    /// `key:action` hints for what can be done right now, as many as fit.
    fn footer_hints(&self, width: u16) -> Line<'static> {
        let hints: &[(&str, &str)] = if self.picker.is_some() {
            &[("↑↓", "choose"), ("enter", "select"), ("esc", "cancel")]
        } else if self.stream.is_some() {
            &[("esc", "stop"), ("ctrl+\\", "sessions"), ("↑↓", "scroll"), ("ctrl+c", "quit")]
        } else {
            &[("enter", "send"), ("ctrl+\\", "sessions"), ("/", "commands"), ("↑↓", "scroll"), ("ctrl+c", "quit")]
        };
        let mut spans = Vec::new();
        let mut used = 0;
        for (i, (key, action)) in hints.iter().enumerate() {
            let sep = if i > 0 { "  │  " } else { "" };
            used += sep.width() + key.width() + action.width() + 1;
            if used > width as usize {
                break;
            }
            spans.push(Span::styled(sep, dim()));
            spans.push(Span::styled(key.to_string(), Style::default().add_modifier(Modifier::BOLD)));
            spans.push(Span::styled(format!(":{action}"), dim()));
        }
        Line::from(spans)
    }

    /// The conversation rows on screen: the written history, then the reply
    /// still streaming, `scroll` rows up from the bottom.
    fn chat_lines(&mut self, width: u16, height: usize) -> Vec<Line<'static>> {
        let live = render::wrap(&self.live_lines(), width);
        let total = self.wrapped.len() + live.len();
        // Scrolled up, new output below must not move what is being read.
        if self.scroll > 0 && total > self.rows {
            self.scroll += total - self.rows;
        }
        self.rows = total;
        self.page = height;
        self.scroll = self.scroll.min(total.saturating_sub(height));
        let start = total.saturating_sub(height + self.scroll);
        self.wrapped.iter().chain(live.iter()).skip(start).take(height).cloned().collect()
    }

    /// What sits between the conversation and the composer: a picker, the
    /// command list, an approval prompt or the spinner, and any notice.
    fn panel_lines(&self, max: usize) -> Vec<Line<'static>> {
        if let Some(picker) = &self.picker {
            return picker_lines(picker, (picker.items.len() + 2).min(max));
        }
        if let Some(cmds) = self.command_hints() {
            return cmds;
        }
        let mut lines = Vec::new();
        if self.pending_approval().is_some() {
            lines.push(Line::from(vec![
                Span::styled(
                    "  Allow the command above?  ",
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                ),
                Span::raw("y "),
                Span::styled("yes  ", dim()),
                Span::raw("n "),
                Span::styled("no", dim()),
            ]));
        } else if self.stream.is_some() {
            let label = if self.stopping { "Stopping…" } else { self.phase.as_deref().unwrap_or("Working…") };
            lines.push(Line::from(vec![
                Span::styled(format!("{} ", SPINNER[self.tick % SPINNER.len()]), Style::default().fg(Color::Cyan)),
                Span::styled(label.to_string(), dim()),
                Span::styled("  esc to stop", dim()),
            ]));
        }
        if self.scroll > 0 {
            lines.push(Line::from(Span::styled(format!("▼ {} more", self.scroll), dim())).centered());
        }
        if let Some(notice) = &self.notice {
            lines.push(Line::from(Span::styled(notice.clone(), Style::default().fg(Color::Yellow))));
        }
        lines
    }

    fn command_hints(&self) -> Option<Vec<Line<'static>>> {
        let typed = self.input.trim();
        if !typed.starts_with('/') || typed.contains(' ') {
            return None;
        }
        let lines: Vec<Line<'static>> = COMMANDS
            .iter()
            .filter(|(name, _)| name.starts_with(typed))
            .map(|(name, help)| {
                Line::from(vec![
                    Span::styled(format!("  {name:<10}"), Style::default().fg(Color::Cyan)),
                    Span::styled(help.to_string(), dim()),
                ])
            })
            .collect();
        (!lines.is_empty()).then_some(lines)
    }

    // MARK: - Keys

    async fn on_key(&mut self, key: KeyEvent) {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        if ctrl && matches!(key.code, KeyCode::Char('\\') | KeyCode::Char('4')) {
            return if matches!(self.picker, Some(Picker { action: PickAction::Conversation, .. })) {
                self.picker = None;
            } else {
                self.open_conversation_picker().await;
            };
        }
        if self.picker.is_some() {
            return self.on_picker_key(key).await;
        }
        match key.code {
            KeyCode::Char('c') if ctrl => {
                if self.stream.is_some() {
                    self.stop().await;
                } else if !self.input.is_empty() {
                    self.set_input(String::new());
                } else {
                    self.quit = true;
                }
            }
            KeyCode::Char('d') if ctrl && self.input.is_empty() => self.quit = true,
            KeyCode::Esc => {
                if self.stream.is_some() {
                    self.stop().await;
                } else {
                    self.notice = None;
                    self.scroll = 0;
                }
            }
            KeyCode::Up => self.scroll += 1,
            KeyCode::Down => self.scroll = self.scroll.saturating_sub(1),
            KeyCode::PageUp => self.scroll += self.page.saturating_sub(1).max(1),
            KeyCode::PageDown => self.scroll = self.scroll.saturating_sub(self.page.saturating_sub(1).max(1)),
            KeyCode::Char(ch @ ('y' | 'n')) if self.input.is_empty() && self.pending_approval().is_some() => {
                self.decide(ch == 'y');
            }
            KeyCode::Enter if key.modifiers.intersects(KeyModifiers::ALT | KeyModifiers::SHIFT) => self.insert("\n"),
            KeyCode::Char('j') if ctrl => self.insert("\n"),
            KeyCode::Enter => {
                self.scroll = 0;
                self.submit().await;
            }
            KeyCode::Char('u') if ctrl => self.set_input(String::new()),
            KeyCode::Char('a') if ctrl => self.caret = 0,
            KeyCode::Char('e') if ctrl => self.caret = self.input.chars().count(),
            KeyCode::Home => self.caret = 0,
            KeyCode::End => self.caret = self.input.chars().count(),
            KeyCode::Left => self.caret = self.caret.saturating_sub(1),
            KeyCode::Right => self.caret = (self.caret + 1).min(self.input.chars().count()),
            KeyCode::Backspace if self.caret > 0 => {
                self.caret -= 1;
                self.remove_at(self.caret);
            }
            KeyCode::Delete if self.caret < self.input.chars().count() => self.remove_at(self.caret),
            KeyCode::Tab => {
                if let Some((name, _)) =
                    COMMANDS.iter().find(|(n, _)| self.input.starts_with('/') && n.starts_with(self.input.trim()))
                {
                    self.set_input(name.to_string());
                }
            }
            KeyCode::Char(ch) if !ctrl => self.insert(&ch.to_string()),
            _ => {}
        }
    }

    fn insert(&mut self, text: &str) {
        let text: String = text.split('\n').map(render::clean).collect::<Vec<_>>().join("\n");
        let text = text.as_str();
        let at = self.byte_at(self.caret);
        self.input.insert_str(at, text);
        self.caret += text.chars().count();
    }

    fn remove_at(&mut self, char_index: usize) {
        let at = self.byte_at(char_index);
        self.input.remove(at);
    }

    fn byte_at(&self, char_index: usize) -> usize {
        self.input.char_indices().nth(char_index).map_or(self.input.len(), |(i, _)| i)
    }

    fn set_input(&mut self, text: String) {
        self.caret = text.chars().count();
        self.input = text;
    }

    async fn submit(&mut self) {
        let text = self.input.trim().to_string();
        if text.is_empty() {
            return;
        }
        if text.starts_with('/') {
            let name = text.split_whitespace().next().unwrap_or_default();
            let command = COMMANDS.iter().map(|(n, _)| *n).find(|n| n.starts_with(name));
            self.set_input(String::new());
            self.notice = None;
            match command {
                Some("/model") => self.open_model_picker().await,
                Some("/runtime") => self.open_runtime_picker(),
                Some("/team") => self.open_team_picker().await,
                Some("/new") => {
                    if self.stream.is_some() {
                        self.notice = Some("Wait for the reply to finish, or press esc to stop it.".into());
                    } else {
                        self.new_conversation();
                    }
                }
                Some("/resume") => self.open_conversation_picker().await,
                Some("/logout") => {
                    let _ = config::write_session(&config::Session::default());
                    self.is_new = true;
                    self.quit = true;
                }
                Some("/quit") => self.quit = true,
                _ => self.notice = Some(format!("Unknown command {name}")),
            }
            return;
        }
        if self.stream.is_some() {
            self.notice = Some("Wait for the reply to finish, or press esc to stop it.".into());
            return;
        }
        self.set_input(String::new());
        self.send(&text);
    }

    // MARK: - Conversation

    /// Each conversation gets the screen to itself. A reply still running
    /// keeps going on the server; this client just stops following it.
    fn new_conversation(&mut self) {
        if let Some(stream) = self.stream.take() {
            stream.task.abort();
        }
        self.phase = None;
        self.stopping = false;
        self.pending_output.clear();
        self.history.clear();
        self.wrapped.clear();
        self.scroll = 0;
        self.announced.clear();
        self.title = None;
        self.session_id = uuid::Uuid::new_v4().to_string();
        self.is_new = true;
        self.ended.clear();
        self.messages.clear();
        self.base_index = 0;
        self.assistant = None;
        self.cursor = Cursor::default();
        self.runtime = self.default_runtime();
        self.model_label = self.runtime_default_model();
    }

    fn send(&mut self, text: &str) {
        // A new message answers "no" to anything still waiting for approval.
        if let Some(at) = self.pending_approval() {
            tx::answer_approval(&mut self.messages, at, false);
        }
        self.messages.push(tx::user_message(text));
        self.assistant = None;
        let first = self.is_new;
        self.is_new = false;
        let mut body = self.chat_body();
        if first {
            body["permissionMode"] = json!("auto");
            if let Some(runtime) = &self.runtime {
                body["runtimeId"] = runtime["id"].clone();
                body["agentRuntime"] = runtime["provider"].clone();
            }
        }
        self.start_stream(body);
    }

    /// Answers the call waiting for approval and continues the turn. The
    /// decision travels on the tool part itself.
    fn decide(&mut self, approved: bool) {
        let Some(at) = self.pending_approval() else { return };
        tx::answer_approval(&mut self.messages, at, approved);
        let mut body = self.chat_body();
        body["continueAfterInterruption"] = json!(true);
        body["resumeReason"] = json!("approval-decision");
        self.start_stream(body);
    }

    fn chat_body(&self) -> Value {
        tx::chat_body(&self.session_id, &self.team_id(), self.base_index, &self.messages)
    }

    fn start_stream(&mut self, body: Value) {
        if let Some(old) = self.stream.take() {
            old.task.abort();
        }
        let id = body["streamId"].as_str().unwrap_or_default().to_string();
        let api = self.api.clone();
        let sender = self.tx.clone();
        let task = tokio::spawn(async move { api.chat(body, sender).await });
        self.stream = Some(Stream { id, task });
        self.phase = None;
        self.stopping = false;
        self.notice = None;
    }

    async fn stop(&mut self) {
        if self.stopping {
            return;
        }
        self.stopping = true;
        if let Err(e) = self.api.cancel_runtime(&self.team_id(), &self.session_id).await {
            // Never admitted on the server: nothing to stop but the request.
            if let Some(stream) = self.stream.take() {
                stream.task.abort();
            }
            self.end_turn(Some(e.message));
        }
    }

    async fn on_stream(&mut self, event: StreamEvent) {
        match event {
            StreamEvent::Frame(id, frame) if self.is_current(&id) => self.on_frame(frame),
            StreamEvent::Ended(id, error) if self.is_current(&id) => {
                self.ended.push(id);
                self.stream = None;
                self.end_turn(error);
                self.refresh_model_label().await;
            }
            _ => {}
        }
    }

    fn is_current(&self, stream_id: &str) -> bool {
        self.stream.as_ref().is_some_and(|s| s.id == stream_id)
    }

    fn end_turn(&mut self, error: Option<String>) {
        self.stream = None;
        self.phase = None;
        self.stopping = false;
        if let Some(i) = self.assistant {
            tx::finish_streaming_parts(&mut self.messages[i]);
        }
        if error.is_some() {
            self.notice = error;
        }
    }

    fn on_frame(&mut self, frame: Value) {
        let kind = frame["type"].as_str().unwrap_or_default().to_string();
        match kind.as_str() {
            "phase" => {
                self.phase = frame["phase"].as_str().map(phase_label);
                return;
            }
            "atlas-turn-complete" | "atlas-turn-paused" | "atlas-stream-done" => {
                self.phase = None;
                return;
            }
            "atlas-transcript-snapshot" => {
                // The server's ordering for the whole conversation. Whatever
                // streamed so far is written out first, then output resumes
                // after the end of the snapshot.
                if let Some(messages) = frame["messages"].as_array().filter(|m| !m.is_empty()) {
                    let finished = self.take_finished(true);
                    self.pending_output.extend(finished);
                    self.messages = messages.clone();
                    self.base_index = 0;
                    self.assistant = self.messages.iter().rposition(|m| role(m) == "assistant");
                    let last = self.messages.len() - 1;
                    self.cursor =
                        Cursor { msg: last, part: parts(&self.messages[last]).len().max(1), ..Cursor::default() };
                }
                return;
            }
            "atlas-turn-start" => {
                for message in frame["messages"].as_array().into_iter().flatten() {
                    if !self.messages.iter().any(|m| m["id"] == message["id"]) {
                        self.messages.push(message.clone());
                    }
                }
                self.assistant = None;
                return;
            }
            "atlas-autonomous-turn-start" => {
                let mut message = tx::assistant_message();
                if let Some(id) = frame["messageId"].as_str() {
                    message["id"] = json!(id);
                }
                self.messages.push(message);
                self.assistant = Some(self.messages.len() - 1);
                return;
            }
            "turn-interrupted" => {
                self.notice = frame["message"].as_str().map(String::from);
                return;
            }
            "error" => {
                self.notice = Some(frame["errorText"].as_str().unwrap_or("The agent hit an error.").to_string());
                return;
            }
            k if k.starts_with("atlas-")
                || k == "runtime-state"
                || k.starts_with("memory-")
                || k == "authorization-decision"
                || k == "data-steering" =>
            {
                return;
            }
            _ => {}
        }

        // A replayed `start` rebuilds its own message.
        if kind == "start" {
            if let Some(i) = frame["messageId"].as_str().and_then(|id| self.messages.iter().position(|m| m["id"] == id))
            {
                self.messages[i]["parts"] = json!([]);
                self.assistant = Some(i);
            }
        }
        let i = match self.assistant {
            Some(i) => i,
            None => {
                self.messages.push(tx::assistant_message());
                self.messages.len() - 1
            }
        };
        self.assistant = Some(i);
        if matches!(kind.as_str(), "text-delta" | "reasoning-delta" | "tool-input-start" | "tool-input-available") {
            self.phase = None;
        }
        if let tx::Outcome::Error(text) = tx::apply(&mut self.messages[i], &frame) {
            self.notice = Some(text);
        }
    }

    // MARK: - Runtimes and models

    async fn load_runtimes(&mut self) {
        match self.api.runtimes(&self.team_id()).await {
            Ok(list) => self.runtimes = shared::active_runtimes(list),
            Err(e) => self.notice = Some(format!("Could not load agents: {e}")),
        }
    }

    fn default_runtime(&self) -> Option<Value> {
        shared::default_runtime(&self.runtimes, &self.prefs, &self.team_id(), &self.me_id)
    }

    fn runtime_default_model(&self) -> Option<String> {
        self.runtime.as_ref()?["defaults"]["model"].as_str().filter(|m| *m != "default").map(String::from)
    }

    async fn refresh_model_label(&mut self) {
        if self.is_new {
            return;
        }
        if let Ok(config) = self.api.model_config(&self.team_id(), &self.session_id).await {
            if let Some(label) = option_of_kind(&config, "model").and_then(current_name) {
                self.model_label = Some(label);
            }
        }
    }

    fn open_runtime_picker(&mut self) {
        if self.stream.is_some() {
            self.notice = Some("Wait for the reply to finish before switching agents.".into());
            return;
        }
        let current = self.runtime.as_ref().map(|r| r["id"].clone());
        let items: Vec<_> =
            self.runtimes.iter().map(|r| (shared::label(r), shared::runtime_detail(r), r.clone())).collect();
        if items.is_empty() {
            self.notice = Some("This team has no active agents.".into());
            return;
        }
        let selected = items.iter().position(|(_, _, r)| Some(&r["id"]) == current.as_ref()).unwrap_or(0);
        self.picker =
            Some(Picker { title: "Run this conversation on".into(), items, selected, action: PickAction::Runtime });
    }

    async fn choose_runtime(&mut self, runtime: Value) {
        let team = self.team_id();
        if self.is_new {
            if let Some(id) = runtime["id"].as_str() {
                self.prefs.runtime_ids.insert(team, id.to_string());
                config::write_prefs(&self.prefs);
            }
            self.runtime = Some(runtime);
            self.model_label = self.runtime_default_model();
            return;
        }
        let mode = shared::move_mode(self.runtime.as_ref(), &runtime);
        let id = runtime["id"].as_str().unwrap_or_default().to_string();
        match self.api.move_runtime(&team, &self.session_id, &id, mode).await {
            Ok(moved) => {
                let label = moved["runtimeLabel"].as_str().or(runtime["label"].as_str()).unwrap_or("agent").to_string();
                self.pending_output.push(Line::from(Span::styled(format!("  ↪ moved to {label} ({mode})"), dim())));
                self.runtime = Some(runtime);
                self.model_label = None;
                self.refresh_model_label().await;
            }
            Err(e) => self.notice = Some(e.message),
        }
    }

    async fn open_model_picker(&mut self) {
        if self.stream.is_some() {
            self.notice = Some("Wait for the reply to finish before changing the model.".into());
            return;
        }
        let team = self.team_id();
        if !self.is_new {
            match self.api.model_config(&team, &self.session_id).await {
                Ok(config) => match option_of_kind(&config, "model") {
                    Some(option) => self.picker = option_picker(option, "Model"),
                    None => self.notice = Some("This agent does not offer a model choice right now.".into()),
                },
                Err(e) => self.notice = Some(e.message),
            }
            return;
        }
        // A new conversation starts on the runtime's defaults, as on the desktop.
        let Some(runtime) = self.runtime.clone() else {
            self.notice = Some("Choose an agent with /runtime first.".into());
            return;
        };
        if runtime["kind"] == "local" {
            self.notice =
                Some("Change a local agent's default model in the desktop app, or send a message first.".into());
            return;
        }
        let id = runtime["id"].as_str().unwrap_or_default();
        match self.api.runtime_models(&team, id, None).await {
            Ok(catalog) => {
                let current =
                    runtime["defaults"]["model"].as_str().or(catalog["controls"]["modelId"].as_str()).map(String::from);
                let items: Vec<_> = catalog["models"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|m| {
                        let id = m["id"].as_str().unwrap_or_default();
                        (
                            m["name"].as_str().unwrap_or(id).to_string(),
                            m["description"].as_str().unwrap_or_default().to_string(),
                            json!(id),
                        )
                    })
                    .collect();
                if items.is_empty() {
                    self.notice =
                        catalog["message"].as_str().map(String::from).or(Some("No models are available.".into()));
                    return;
                }
                let selected = items.iter().position(|(_, _, v)| v.as_str() == current.as_deref()).unwrap_or(0);
                self.picker = Some(Picker {
                    title: "Default model for new conversations on this agent (team setting)".into(),
                    items,
                    selected,
                    action: PickAction::DefaultModel,
                });
            }
            Err(e) if e.status == 403 => {
                self.notice =
                    Some("Only team administrators can change a Cloud agent's model before the first message.".into())
            }
            Err(e) => self.notice = Some(e.message),
        }
    }

    async fn choose_session_option(&mut self, config_id: String, value: Value) {
        let team = self.team_id();
        let value = value.as_str().unwrap_or_default().to_string();
        match self.api.set_model_config(&team, &self.session_id, &config_id, &value).await {
            Ok(config) => {
                if let Some(label) = option_of_kind(&config, "model").and_then(current_name) {
                    self.model_label = Some(label);
                }
                // After the model, offer its effort levels.
                let is_model = option_of_kind(&config, "model").is_some_and(|o| o["id"] == config_id.as_str());
                if is_model {
                    if let Some(effort) = option_of_kind(&config, "effort") {
                        self.picker = option_picker(effort, "Reasoning effort");
                    }
                }
            }
            Err(e) => self.notice = Some(busy_message(e)),
        }
    }

    async fn choose_default_model(&mut self, model: String) {
        let Some(runtime) = self.runtime.clone() else { return };
        let team = self.team_id();
        let id = runtime["id"].as_str().unwrap_or_default();
        let controls = self.api.runtime_models(&team, id, Some(&model)).await.ok().map(|c| c["controls"].clone());
        let efforts: Vec<Value> = controls
            .as_ref()
            .and_then(|c| c["effort"].as_array())
            .map(|a| a.iter().filter(|o| o["value"] != "default").cloned().collect())
            .unwrap_or_default();
        if efforts.is_empty() {
            return self.save_defaults(json!({ "model": model })).await;
        }
        let inherited =
            runtime["defaults"]["effort"].as_str().or(controls.as_ref().and_then(|c| c["defaultEffort"].as_str()));
        let selected = efforts
            .iter()
            .position(|o| o["value"].as_str() == inherited)
            .or_else(|| efforts.iter().position(|o| o["value"] == "medium"))
            .unwrap_or(0);
        let items = efforts
            .iter()
            .map(|o| {
                (
                    o["name"].as_str().or(o["value"].as_str()).unwrap_or_default().to_string(),
                    String::new(),
                    o["value"].clone(),
                )
            })
            .collect();
        self.picker = Some(Picker {
            title: "Reasoning effort".into(),
            items,
            selected,
            action: PickAction::DefaultEffort { model },
        });
    }

    async fn save_defaults(&mut self, defaults: Value) {
        let Some(runtime) = self.runtime.clone() else { return };
        let id = runtime["id"].as_str().unwrap_or_default();
        match self.api.set_runtime_defaults(&self.team_id(), id, &defaults).await {
            Ok(_) => {
                self.load_runtimes().await;
                self.runtime = self.runtimes.iter().find(|r| r["id"] == runtime["id"]).cloned().or(Some(runtime));
                if let Some(r) = self.runtime.as_mut() {
                    r["defaults"] = defaults;
                }
                self.model_label = self.runtime_default_model();
            }
            Err(e) => self.notice = Some(e.message),
        }
    }

    // MARK: - Teams

    async fn open_team_picker(&mut self) {
        if self.stream.is_some() {
            self.notice = Some("Wait for the reply to finish, or press esc to stop it.".into());
            return;
        }
        match self.api.teams().await {
            Ok(teams) => {
                let selected = teams.iter().position(|t| t["id"] == self.team["id"]).unwrap_or(0);
                let items = teams.into_iter().map(|t| (shared::label(&t), String::new(), t)).collect();
                self.picker = Some(Picker { title: "Switch team".into(), items, selected, action: PickAction::Team });
            }
            Err(e) => self.notice = Some(e.message),
        }
    }

    async fn choose_team(&mut self, team: Value) {
        if team["id"] == self.team["id"] {
            return;
        }
        shared::remember_team(&mut self.prefs, &team);
        self.team = team;
        self.load_runtimes().await;
        self.messages.clear();
        self.new_conversation();
    }

    // MARK: - Resume

    async fn open_conversation_picker(&mut self) {
        match self.api.conversations(&self.team_id()).await {
            Ok(mut list) if !list.is_empty() => {
                // Running ones first; the server already sorts by activity.
                list.sort_by_key(|c| c["activeRun"].is_null());
                let items = list
                    .into_iter()
                    .map(|c| {
                        let mut detail = shared::conversation_time(&c);
                        if !c["activeRun"].is_null() {
                            detail = format!("● running · {detail}");
                        }
                        (shared::conversation_title(&c), detail, c)
                    })
                    .collect();
                self.picker =
                    Some(Picker { title: "Sessions".into(), items, selected: 0, action: PickAction::Conversation });
            }
            Ok(_) => self.notice = Some("No conversations yet.".into()),
            Err(e) => self.notice = Some(e.message),
        }
    }

    async fn resume(&mut self, summary: Value) {
        let Some(id) = summary["sessionId"].as_str().map(String::from) else { return };
        let detail = match self.api.conversation(&self.team_id(), &id).await {
            Ok(d) => d,
            Err(e) => {
                self.notice = Some(e.message);
                return;
            }
        };
        self.new_conversation();
        self.session_id = id;
        self.is_new = false;
        self.base_index = detail["messagesFirstIndex"].as_u64().unwrap_or(0) as usize;
        self.runtime = detail["runtimeId"]
            .as_str()
            .and_then(|rid| self.runtimes.iter().find(|r| r["id"] == rid))
            .cloned()
            .or_else(|| detail["runtimeLabel"].as_str().map(|label| json!({ "label": label })));
        self.title = Some(shared::conversation_title(&detail));
        if self.base_index > 0 {
            let note = format!("({} earlier messages not shown)", self.base_index);
            self.pending_output.push(Line::from(Span::styled(note, dim())));
        }
        self.model_label = None;
        self.refresh_model_label().await;
        self.follow(&detail);
    }

    /// Takes in what the server has beyond what is shown, and attaches to a
    /// reply running there — one started here earlier, or from another
    /// device such as the desktop app.
    fn follow(&mut self, detail: &Value) {
        let base = detail["messagesFirstIndex"].as_u64().unwrap_or(0) as usize;
        let mut server = detail["messages"].as_array().cloned().unwrap_or_default();
        let running =
            detail["activeRun"]["streamId"].as_str().filter(|id| !self.ended.iter().any(|e| e == id)).map(String::from);
        if running.is_some() {
            // The reply in progress is rebuilt from its stream.
            if let Some(last_user) = server.iter().rposition(|m| role(m) == "user") {
                server.truncate(last_user + 1);
            }
        }
        let shown = self.base_index + self.messages.len();
        for (i, message) in server.into_iter().enumerate() {
            if base + i >= shown && !self.messages.iter().any(|m| m["id"] == message["id"]) {
                self.messages.push(message);
            }
        }
        self.assistant = self.messages.iter().rposition(|m| role(m) == "assistant");
        if let Some(stream_id) = running {
            self.assistant = None;
            let mut body = self.chat_body();
            body["streamId"] = json!(stream_id);
            body["resume"] = json!(true);
            self.start_stream(body);
        }
    }

    /// While idle, checks the conversation every few seconds so turns sent
    /// from elsewhere show up here, as the iOS app does.
    async fn poll(&mut self) {
        if self.is_new || self.stream.is_some() || self.picker.is_some() {
            return;
        }
        if let Ok(detail) = self.api.conversation(&self.team_id(), &self.session_id).await {
            if self.stream.is_none() {
                self.follow(&detail);
            }
        }
    }

    // MARK: - Picker

    async fn on_picker_key(&mut self, key: KeyEvent) {
        let Some(picker) = self.picker.as_mut() else { return };
        match key.code {
            KeyCode::Up => picker.selected = picker.selected.saturating_sub(1),
            KeyCode::Down => picker.selected = (picker.selected + 1).min(picker.items.len().saturating_sub(1)),
            KeyCode::Esc => self.picker = None,
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => self.picker = None,
            KeyCode::Enter => {
                let Some(picker) = self.picker.take() else { return };
                let Some((_, _, value)) = picker.items.into_iter().nth(picker.selected) else { return };
                match picker.action {
                    PickAction::Team => self.choose_team(value).await,
                    PickAction::Runtime => self.choose_runtime(value).await,
                    PickAction::Conversation => self.resume(value).await,
                    PickAction::SessionOption { config_id } => self.choose_session_option(config_id, value).await,
                    PickAction::DefaultModel => {
                        self.choose_default_model(value.as_str().unwrap_or_default().to_string()).await
                    }
                    PickAction::DefaultEffort { model } => {
                        self.save_defaults(json!({ "model": model, "effort": value })).await
                    }
                }
            }
            _ => {}
        }
    }
}

/// The sessions page: running conversations, then recent ones, each with
/// how long ago it was active on the right.
fn session_lines(picker: &Picker, area: Rect) -> Vec<Line<'static>> {
    let width = area.width as usize;
    let mut lines = vec![Line::from(Span::styled("Sessions", Style::default().add_modifier(Modifier::BOLD)))];
    let mut rows = Vec::new();
    let mut group = None;
    for (i, (title, detail, c)) in picker.items.iter().enumerate() {
        let running = !c["activeRun"].is_null();
        if group != Some(running) {
            group = Some(running);
            rows.push((None, Line::default()));
            rows.push((None, Line::from(Span::styled(if running { "Running" } else { "Recent" }, dim()))));
        }
        let selected = i == picker.selected;
        let time = detail.trim_start_matches("● running · ").to_string();
        let marker = if running { "● " } else { "  " };
        let room = width.saturating_sub(time.width() + 6);
        let title: String = title
            .chars()
            .scan(0, |w, ch| {
                *w += ch.to_string().width();
                (*w <= room).then_some(ch)
            })
            .collect();
        let gap = width.saturating_sub(title.width() + time.width() + 4);
        let style =
            if selected { Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD) } else { Style::default() };
        rows.push((
            Some(i),
            Line::from(vec![
                Span::styled(if selected { "› " } else { "  " }, style),
                Span::styled(marker, Style::default().fg(Color::Green)),
                Span::styled(title, style),
                Span::raw(" ".repeat(gap)),
                Span::styled(time, dim()),
            ]),
        ));
    }
    // Keep the selected row on screen.
    let room = (area.height as usize).saturating_sub(1);
    let at = rows.iter().position(|(i, _)| *i == Some(picker.selected)).unwrap_or(0);
    let first = (at + 1).saturating_sub(room);
    lines.extend(rows.into_iter().skip(first).take(room).map(|(_, line)| line));
    lines
}

/// Leaves the alternate screen and the modes the TUI turned on; also run on a panic.
fn restore_terminal() {
    let _ = execute!(
        stdout(),
        crossterm::style::Print(ALTERNATE_SCROLL_OFF),
        DisableBracketedPaste,
        LeaveAlternateScreen,
        crossterm::cursor::Show
    );
    let _ = disable_raw_mode();
}

fn picker_lines(picker: &Picker, height: usize) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(Span::styled(picker.title.clone(), Style::default().add_modifier(Modifier::BOLD)))];
    let rows = height.saturating_sub(2).max(1);
    let first = picker.selected.saturating_sub(rows - 1);
    for (i, (label, detail, _)) in picker.items.iter().enumerate().skip(first).take(rows) {
        let selected = i == picker.selected;
        let marker = if selected { "› " } else { "  " };
        let style =
            if selected { Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD) } else { Style::default() };
        lines.push(Line::from(vec![
            Span::styled(format!("{marker}{label}"), style),
            Span::styled(if detail.is_empty() { String::new() } else { format!("  {detail}") }, dim()),
        ]));
    }
    lines.push(Line::from(Span::styled("  ↑↓ choose · enter select · esc cancel", dim())));
    lines
}

fn message_text(message: &Value) -> String {
    parts(message)
        .iter()
        .filter(|p| part_type(p) == "text")
        .filter_map(|p| p["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn option_picker(option: &Value, title: &str) -> Option<Picker> {
    let current = option["currentValue"].clone();
    let items: Vec<_> = option["options"]
        .as_array()?
        .iter()
        .map(|v| {
            let value = v["value"].as_str().unwrap_or_default();
            (
                v["name"].as_str().unwrap_or(value).to_string(),
                v["description"].as_str().unwrap_or_default().to_string(),
                json!(value),
            )
        })
        .collect();
    if items.is_empty() {
        return None;
    }
    let selected = items.iter().position(|(_, _, v)| *v == current).unwrap_or(0);
    Some(Picker {
        title: title.to_string(),
        items,
        selected,
        action: PickAction::SessionOption { config_id: option["id"].as_str().unwrap_or_default().to_string() },
    })
}

fn busy_message(e: ApiError) -> String {
    match e.code.as_deref() {
        Some("runtime_busy") => "Wait for the current reply to finish before changing model settings.".into(),
        Some("runtime_not_started") => "The agent has not started yet; send a message first.".into(),
        _ => e.message,
    }
}

/// `phase` frames carry a short machine name; show it as words.
fn phase_label(phase: &str) -> String {
    let words = phase.replace(['-', '_'], " ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => format!("{}{}…", first.to_uppercase(), chars.as_str()).replace("……", "…"),
        None => "Working…".into(),
    }
}
