//! The terminal UI. Like Codex, it takes over the whole screen (the
//! alternate screen): the conversation scrolls above a composer pinned to the
//! bottom. Alternate scroll mode makes the terminal send the mouse wheel as
//! ↑/↓, so the wheel scrolls while the terminal's own text selection still works.

use std::future::Future;
use std::io::{stdout, Stdout};
use std::time::{Duration, Instant};

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
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::api::{Api, ApiError, Method, StreamEvent};
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
    "Use /agents to run this conversation on another agent, or to add one.",
    "Use /model to change the model and reasoning effort.",
];
/// The agents Nuphos can run for a team, as the desktop's Add agent offers them.
const PROVIDERS: [(&str, &str); 4] =
    [("claude-code", "Claude Code"), ("codex", "Codex"), ("grok", "Grok Build"), ("antigravity", "Antigravity")];
/// How long a sign-in may take, from starting the agent to the browser.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const SPINNER: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const COMMANDS: [(&str, &str); 8] = [
    ("/model", "choose the model and reasoning effort"),
    ("/team", "switch to another team"),
    ("/agents", "choose, add or sign in the agents this team runs on"),
    ("/new", "start a new conversation"),
    ("/resume", "continue a previous conversation"),
    ("/archive", "archive this conversation and start a new one"),
    ("/logout", "sign out of Nuphos here and in the desktop app"),
    ("/quit", "exit"),
];

type Term = Terminal<CrosstermBackend<Stdout>>;
/// What a background request does to the app once it returns.
type Apply = Box<dyn FnOnce(&mut App) + Send>;

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

/// A question the composer answers instead of sending a message.
enum Ask {
    PairUrl,
    PairCode { url: String },
    LoginCode { runtime: Value, attempt: String, deadline: Instant, url: String },
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
    /// The team's conversations as last fetched, so Sessions opens at once.
    sessions: Vec<Value>,
    /// Others' conversations I take part in, and my sidebar favorites
    /// (`{ entries, revision }`), whose conversations are the pinned ones.
    shared_sessions: Vec<Value>,
    favorites: Value,
    sessions_loading: bool,
    /// A conversation being opened, or checked for news while idle.
    loading: bool,
    polling: bool,
    /// The question the composer is answering, and a sign-in in progress.
    ask: Option<(String, Ask)>,
    signing: Option<String>,
    /// Since when the agent being signed in has been starting.
    starting_since: Option<Instant>,
    /// Requests the spinner is shown for.
    busy: usize,
    apply_tx: UnboundedSender<Apply>,
    apply_rx: UnboundedReceiver<Apply>,
    /// Streams of this conversation already followed to the end; the server
    /// can list one as running for a moment after it ends.
    ended: Vec<String>,

    tx: UnboundedSender<StreamEvent>,
    rx: UnboundedReceiver<StreamEvent>,
}

impl App {
    pub async fn new(api: Api, me_id: String, team: Value, prefs: Prefs) -> Result<Self> {
        let (tx, rx) = unbounded_channel();
        let (apply_tx, apply_rx) = unbounded_channel();
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
            sessions: Vec::new(),
            shared_sessions: Vec::new(),
            favorites: json!({ "entries": [] }),
            sessions_loading: false,
            loading: false,
            polling: false,
            busy: 0,
            ask: None,
            signing: None,
            starting_since: None,
            apply_tx,
            apply_rx,
            update: None,
            title: None,
            tx,
            rx,
        };
        match app.api.runtimes(&app.team_id()).await {
            Ok(list) => app.runtimes = shared::active_runtimes(list),
            Err(e) => app.notice = Some(format!("Could not load agents: {e}")),
        }
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

        self.fetch_sessions();
        if crate::update::check_enabled() {
            self.update_check = Some(tokio::spawn(crate::update::latest()));
        }
        match start {
            Start::New => {}
            Start::Resume(Some(id)) => self.resume(json!({ "sessionId": id })),
            Start::Resume(None) => self.open_conversation_picker(),
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
                Some(apply) = self.apply_rx.recv() => apply(self),
                _ = poller.tick() => self.poll(),
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
        let input_lines = self.composer_view(area.width.saturating_sub(6)).0.len().clamp(1, 6) as u16;
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
            let empty = if self.sessions_loading { "Loading…" } else { "No conversations yet." };
            f.render_widget(Paragraph::new(session_lines(picker, chat_area, empty)), chat_area);
            self.draw_composer(f, composer_area);
            return f.render_widget(Paragraph::new(self.footer_hints(footer.width)), footer);
        }
        if self.loading {
            let spinner = SPINNER[self.tick % SPINNER.len()];
            let line = Line::from(Span::styled(format!("{spinner} Loading conversation…"), dim()));
            f.render_widget(Paragraph::new(vec![Line::default(), line]), chat_area);
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
        self.is_new && self.messages.is_empty() && self.input.is_empty() && self.picker.is_none() && self.ask.is_none()
    }

    /// Grok Build's home: the mark and the shortcuts in a box a third of the
    /// way down, a tip above the composer, and the endpoint in the corner.
    fn draw_welcome(&mut self, f: &mut Frame, area: Rect) {
        let bold = Style::default().add_modifier(Modifier::BOLD);
        let menu = [
            ("Sessions", "ctrl+\\"),
            ("Switch team", "/team"),
            ("Agents", "/agents"),
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
        let tip_line = match self.signing_status().or(self.notice.clone()).as_ref() {
            Some(text) => Line::from(Span::styled(text.clone(), Style::default().fg(Color::Yellow))),
            None if self.busy > 0 => {
                Line::from(Span::styled(format!("{} Loading…", SPINNER[self.tick % SPINNER.len()]), dim()))
            }
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
            let placeholder = match (&self.ask, self.is_new) {
                (Some((_, Ask::LoginCode { .. })), _) => "Paste the code here",
                (Some(_), _) => "Type the answer and press enter",
                (None, true) => "Ask Nuphos anything",
                (None, false) => "Reply to Nuphos",
            };
            f.render_widget(Paragraph::new(Span::styled(placeholder, dim())), text);
        }
        let (lines, row, col) = self.composer_view(text.width);
        let skip = (row + 1).saturating_sub(text.height as usize);
        if !self.input.is_empty() {
            let shown: Vec<Line> = lines.into_iter().skip(skip).take(text.height as usize).map(Line::from).collect();
            f.render_widget(Paragraph::new(shown), text);
        }
        if self.picker.is_none() {
            f.set_cursor_position(Position::new(text.x + col as u16, text.y + (row - skip) as u16));
        }
    }

    /// The draft as the composer shows it: wrapped to `width`, with the
    /// caret's row and column. A pasted sign-in code shows only its length.
    fn composer_view(&self, width: u16) -> (Vec<String>, usize, usize) {
        if matches!(self.ask, Some((_, Ask::LoginCode { .. }))) && !self.input.is_empty() {
            let text = format!("{} characters pasted · enter to sign in", self.input.chars().count());
            let col = text.width();
            return (vec![text], 0, col);
        }
        let width = width.max(1) as usize;
        let mut lines = vec![String::new()];
        let mut used = 0;
        let mut caret = None;
        for (i, ch) in self.input.chars().enumerate() {
            let w = ch.width().unwrap_or(0);
            if ch != '\n' && used + w > width {
                lines.push(String::new());
                used = 0;
            }
            if i == self.caret {
                caret = Some((lines.len() - 1, used));
            }
            if ch == '\n' {
                lines.push(String::new());
                used = 0;
            } else if let Some(line) = lines.last_mut() {
                line.push(ch);
                used += w;
            }
        }
        let (row, col) = caret.unwrap_or((lines.len() - 1, used));
        (lines, row, col)
    }

    /// `key:action` hints for what can be done right now, as many as fit.
    fn footer_hints(&self, width: u16) -> Line<'static> {
        let sessions = matches!(self.picker, Some(Picker { action: PickAction::Conversation, .. }));
        let hints: &[(&str, &str)] = if sessions {
            &[("↑↓", "choose"), ("enter", "open"), ("p", "pin"), ("esc", "close")]
        } else if matches!(self.picker, Some(Picker { action: PickAction::Runtime, .. })) {
            &[("↑↓", "choose"), ("enter", "use or add"), ("l", "sign in"), ("esc", "close")]
        } else if self.ask.is_some() {
            &[("enter", "answer"), ("esc", "cancel")]
        } else if self.picker.is_some() {
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
        if let Some(signing) = self.signing_status() {
            let spinner = SPINNER[self.tick % SPINNER.len()];
            lines.push(Line::from(Span::styled(format!("{spinner} {signing}"), Style::default().fg(Color::Cyan))));
        }
        match &self.ask {
            Some((title, Ask::LoginCode { url, .. })) => lines.extend([
                Line::from(Span::styled(title.clone(), Style::default().add_modifier(Modifier::BOLD))),
                Line::from(vec![
                    Span::styled("  1. ", dim()),
                    Span::raw("Sign in on the page that opened in your browser."),
                ]),
                Line::from(vec![
                    Span::styled("     Not opened? ", dim()),
                    Span::styled(url.clone(), dim().add_modifier(Modifier::UNDERLINED)),
                ]),
                Line::from(vec![
                    Span::styled("  2. ", dim()),
                    Span::raw("Paste the code it shows below, then press enter."),
                ]),
            ]),
            Some((question, _)) => lines.push(Line::from(Span::styled(
                question.clone(),
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ))),
            None => {}
        }
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
        } else if self.stream.is_none() && self.busy > 0 {
            lines.push(Line::from(Span::styled(format!("{} Loading…", SPINNER[self.tick % SPINNER.len()]), dim())));
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
                self.open_conversation_picker();
            };
        }
        if self.picker.is_some() {
            return self.on_picker_key(key).await;
        }
        match key.code {
            KeyCode::Char('c') if ctrl => {
                if self.stream.is_some() {
                    self.stop();
                } else if !self.input.is_empty() {
                    self.set_input(String::new());
                } else {
                    self.quit = true;
                }
            }
            KeyCode::Char('d') if ctrl && self.input.is_empty() => self.quit = true,
            KeyCode::Esc if self.ask.is_some() => {
                self.ask = None;
                self.signing = None;
                self.set_input(String::new());
            }
            KeyCode::Esc => {
                if self.stream.is_some() {
                    self.stop();
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
        if let Some((_, ask)) = self.ask.take() {
            self.set_input(String::new());
            return self.answer(ask, text);
        }
        if text.starts_with('/') {
            let name = text.split_whitespace().next().unwrap_or_default();
            let command = COMMANDS.iter().map(|(n, _)| *n).find(|n| n.starts_with(name));
            self.set_input(String::new());
            self.notice = None;
            match command {
                Some("/model") => self.open_model_picker(),
                Some("/agents") => self.open_agents(),
                Some("/team") => self.open_team_picker(),
                Some("/new") => self.new_conversation(),
                Some("/archive") => self.archive(),
                Some("/resume") => self.open_conversation_picker(),
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
        if self.stream.is_some() || self.loading {
            let busy = if self.loading { "the conversation to load" } else { "the reply to finish" };
            self.notice = Some(format!("Wait for {busy}, or press esc to stop it."));
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
        self.loading = false;
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

    fn stop(&mut self) {
        if self.stopping {
            return;
        }
        self.stopping = true;
        let (api, team, session) = (self.api.clone(), self.team_id(), self.session_id.clone());
        let stream = self.stream.as_ref().map(|s| s.id.clone());
        self.background(false, async move {
            let result = api.cancel_runtime(&team, &session).await;
            Box::new(move |app: &mut App| {
                // Never admitted on the server: nothing to stop but the request.
                if let Err(e) = result {
                    if app.stream.as_ref().map(|s| s.id.clone()) == stream {
                        if let Some(stream) = app.stream.take() {
                            stream.task.abort();
                        }
                        app.end_turn(Some(e.message));
                    }
                }
            }) as Apply
        });
    }

    async fn on_stream(&mut self, event: StreamEvent) {
        match event {
            StreamEvent::Frame(id, frame) if self.is_current(&id) => self.on_frame(frame),
            StreamEvent::Ended(id, error) if self.is_current(&id) => {
                self.ended.push(id);
                self.stream = None;
                self.end_turn(error);
                self.refresh_model_label();
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

    /// Reloads the team's agents, keeping the one in use (with fresh
    /// defaults) or, if it is gone, the default one.
    fn reload_runtimes(&mut self) {
        let (api, team) = (self.api.clone(), self.team_id());
        self.background(false, async move {
            let result = api.runtimes(&team).await;
            Box::new(move |app: &mut App| {
                if app.team_id() != team {
                    return;
                }
                match result {
                    Ok(list) => {
                        app.runtimes = shared::active_runtimes(list);
                        let current = app.runtime.as_ref().map(|r| r["id"].clone());
                        app.runtime = app
                            .runtimes
                            .iter()
                            .find(|r| Some(&r["id"]) == current.as_ref())
                            .cloned()
                            .or_else(|| app.default_runtime());
                        if app.is_new {
                            app.model_label = app.runtime_default_model();
                        }
                    }
                    Err(e) => app.notice = Some(format!("Could not load agents: {e}")),
                }
            }) as Apply
        });
    }

    fn default_runtime(&self) -> Option<Value> {
        shared::default_runtime(&self.runtimes, &self.prefs, &self.team_id(), &self.me_id)
    }

    fn runtime_default_model(&self) -> Option<String> {
        self.runtime.as_ref()?["defaults"]["model"].as_str().filter(|m| *m != "default").map(String::from)
    }

    fn refresh_model_label(&mut self) {
        if self.is_new {
            return;
        }
        let (api, team, session) = (self.api.clone(), self.team_id(), self.session_id.clone());
        self.background(false, async move {
            let config = api.model_config(&team, &session).await.ok();
            Box::new(move |app: &mut App| {
                let label = config.as_ref().and_then(|c| option_of_kind(c, "model")).and_then(current_name);
                if app.session_id == session && label.is_some() {
                    app.model_label = label;
                }
            }) as Apply
        });
    }

    /// `/agents`: the team's agents to run this conversation on, then ways to
    /// add one: a Nuphos-managed agent, or a self-hosted one by pairing code.
    fn open_agents(&mut self) {
        let current = self.runtime.as_ref().map(|r| r["id"].clone());
        let mut items: Vec<_> =
            self.runtimes.iter().map(|r| (shared::label(r), shared::runtime_detail(r), r.clone())).collect();
        let selected = items.iter().position(|(_, _, r)| Some(&r["id"]) == current.as_ref()).unwrap_or(0);
        for (provider, name) in PROVIDERS {
            items.push((format!("+ New {name} agent"), "Nuphos-managed".into(), json!({ "add": provider })));
        }
        items.push(("+ Connect a self-hosted agent".into(), "pairing code".into(), json!({ "add": "self-hosted" })));
        self.picker = Some(Picker { title: "Agents".into(), items, selected, action: PickAction::Runtime });
    }

    fn add_agent(&mut self, kind: &str) {
        if kind == "self-hosted" {
            self.ask = Some(("The agent's URL, from its console (https://… or wss://…)".into(), Ask::PairUrl));
            return;
        }
        let (api, team, provider) = (self.api.clone(), self.team_id(), kind.to_string());
        self.background(true, async move {
            let result = api.create_runtime(&team, &provider).await;
            Box::new(move |app: &mut App| match result {
                Ok(runtime) => {
                    app.notice = Some(format!("Added {}.", shared::label(&runtime)));
                    app.adopt_agent(&runtime);
                    app.sign_in_agent(runtime);
                }
                Err(e) => app.notice = Some(e.message),
            }) as Apply
        });
    }

    /// A new agent becomes the one new conversations start on.
    fn adopt_agent(&mut self, runtime: &Value) {
        if let Some(id) = runtime["id"].as_str() {
            self.prefs.runtime_ids.insert(self.team_id(), id.to_string());
            config::write_prefs(&self.prefs);
        }
        if self.is_new {
            self.runtime = Some(runtime.clone());
            self.model_label = None;
        }
        self.reload_runtimes();
    }

    /// What the composer was asked for: the pairing URL and code, or the code
    /// a sign-in page shows.
    fn answer(&mut self, ask: Ask, text: String) {
        let (api, team) = (self.api.clone(), self.team_id());
        match ask {
            Ask::PairUrl => {
                self.ask = Some(("The pairing code from the agent's console".into(), Ask::PairCode { url: text }))
            }
            Ask::PairCode { url } => self.background(true, async move {
                let result = api.pair_runtime(&team, &url, &text).await;
                Box::new(move |app: &mut App| match result {
                    Ok(runtime) => {
                        app.notice = Some(format!("Connected {}.", shared::label(&runtime)));
                        app.adopt_agent(&runtime);
                    }
                    Err(e) => app.notice = Some(e.message),
                }) as Apply
            }),
            Ask::LoginCode { runtime, attempt, deadline, .. } => {
                self.signing = Some(format!("Checking the code for {}…", shared::label(&runtime)));
                let id = runtime["id"].as_str().unwrap_or_default().to_string();
                self.background(false, async move {
                    let login = api.submit_runtime_login_code(&team, &id, &attempt, &text).await;
                    Box::new(move |app: &mut App| app.on_login(runtime, login, deadline)) as Apply
                });
            }
        }
    }

    /// Where a sign-in is, with how long the agent has been starting.
    fn signing_status(&self) -> Option<String> {
        let status = self.signing.clone()?;
        Some(match self.starting_since {
            Some(since) => format!("{status} ({}s)", since.elapsed().as_secs()),
            None => status,
        })
    }

    /// `l` on Agents: signs a Cloud or self-hosted agent in to its provider
    /// account. A just-created agent is waited for until it answers.
    fn sign_in_agent(&mut self, runtime: Value) {
        let label = shared::label(&runtime);
        if runtime["kind"] == "local" {
            return self.notice =
                Some(format!("{label} signs in on its own computer, with `nuphos agent` or the app."));
        }
        // A Nuphos-managed agent is a sandbox Nuphos Cloud boots for the team.
        let provider = PROVIDERS.iter().find(|(p, _)| runtime["provider"] == *p).map_or(label.as_str(), |(_, n)| n);
        self.signing = Some(if runtime["kind"] == "managed" {
            format!("Starting your {provider} sandbox in Nuphos Cloud…")
        } else {
            format!("Waiting for {label} to come online…")
        });
        self.starting_since = Some(Instant::now());
        let (api, team) = (self.api.clone(), self.team_id());
        let id = runtime["id"].as_str().unwrap_or_default().to_string();
        let deadline = Instant::now() + SIGN_IN_TIMEOUT;
        self.background(false, async move {
            while !api.runtime_status(&team, &id).await.is_ok_and(|s| s["online"] == true) && Instant::now() < deadline
            {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            let login = api.runtime_login(Method::POST, &team, &id).await;
            Box::new(move |app: &mut App| app.on_login(runtime, login, deadline)) as Apply
        });
    }

    fn on_login(&mut self, runtime: Value, login: Result<Value, ApiError>, deadline: Instant) {
        self.starting_since = None;
        let label = shared::label(&runtime);
        let failed = |app: &mut App, why: String| {
            app.signing = None;
            app.notice = Some(format!("{label} did not sign in: {why}. Try again with l on /agents."));
        };
        let login = match login {
            Ok(login) => login,
            Err(e) => return failed(self, e.message),
        };
        let state = login["state"].as_str().unwrap_or_default();
        if state == "connected" {
            self.signing = None;
            self.notice = Some(format!("{label} is signed in."));
            return self.reload_runtimes();
        }
        if matches!(state, "failed" | "cancelled") {
            return failed(self, render::clean(login["error"].as_str().unwrap_or(state)));
        }
        if Instant::now() > deadline {
            return failed(self, "it took too long".into());
        }
        let submitted = login["codeSubmitted"] == true;
        if let (Some(url), false) = (login["authorizationUrl"].as_str(), submitted) {
            open_https(url);
            self.signing = None;
            self.notice = None;
            let attempt = login["attemptId"].as_str().unwrap_or_default().to_string();
            let url = render::clean(url);
            self.ask = Some((format!("Sign {label} in"), Ask::LoginCode { runtime, attempt, deadline, url }));
            return;
        }
        if let Some(uri) = login["verificationUri"].as_str() {
            let text = format!(
                "Sign {label} in at {} with the code {}",
                render::clean(uri),
                render::clean(login["userCode"].as_str().unwrap_or_default())
            );
            if self.signing.as_deref() != Some(text.as_str()) {
                open_https(uri);
            }
            self.signing = Some(text);
        }
        let (api, team) = (self.api.clone(), self.team_id());
        let id = runtime["id"].as_str().unwrap_or_default().to_string();
        self.background(false, async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let login = api.runtime_login(Method::GET, &team, &id).await;
            Box::new(move |app: &mut App| app.on_login(runtime, login, deadline)) as Apply
        });
    }

    fn choose_runtime(&mut self, runtime: Value) {
        if self.stream.is_some() {
            return self.notice = Some("Wait for the reply to finish before switching agents.".into());
        }
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
        let (api, session) = (self.api.clone(), self.session_id.clone());
        self.background(true, async move {
            let result = api.move_runtime(&team, &session, &id, mode).await;
            Box::new(move |app: &mut App| {
                if app.session_id != session {
                    return;
                }
                match result {
                    Ok(moved) => {
                        let label = moved["runtimeLabel"].as_str().or(runtime["label"].as_str()).unwrap_or("agent");
                        let line = format!("  ↪ moved to {label} ({mode})");
                        app.pending_output.push(Line::from(Span::styled(line, dim())));
                        app.runtime = Some(runtime);
                        app.model_label = None;
                        app.refresh_model_label();
                    }
                    Err(e) => app.notice = Some(e.message),
                }
            }) as Apply
        });
    }

    fn open_model_picker(&mut self) {
        if self.stream.is_some() {
            self.notice = Some("Wait for the reply to finish before changing the model.".into());
            return;
        }
        let (api, team) = (self.api.clone(), self.team_id());
        if !self.is_new {
            let session = self.session_id.clone();
            return self.background(true, async move {
                let result = api.model_config(&team, &session).await;
                Box::new(move |app: &mut App| match result {
                    Ok(config) => match option_of_kind(&config, "model") {
                        Some(option) => app.picker = option_picker(option, "Model"),
                        None => app.notice = Some("This agent does not offer a model choice right now.".into()),
                    },
                    Err(e) => app.notice = Some(e.message),
                }) as Apply
            });
        }
        // A new conversation starts on the runtime's defaults, as on the desktop.
        let Some(runtime) = self.runtime.clone() else {
            self.notice = Some("Choose an agent with /agents first.".into());
            return;
        };
        if runtime["kind"] == "local" {
            self.notice =
                Some("Change a local agent's default model in the desktop app, or send a message first.".into());
            return;
        }
        let id = runtime["id"].as_str().unwrap_or_default().to_string();
        self.background(true, async move {
            let result = api.runtime_models(&team, &id, None).await;
            Box::new(move |app: &mut App| app.show_default_models(&runtime, result)) as Apply
        });
    }

    fn show_default_models(&mut self, runtime: &Value, result: Result<Value, ApiError>) {
        match result {
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

    fn choose_session_option(&mut self, config_id: String, value: Value) {
        let (api, team, session) = (self.api.clone(), self.team_id(), self.session_id.clone());
        let value = value.as_str().unwrap_or_default().to_string();
        self.background(true, async move {
            let result = api.set_model_config(&team, &session, &config_id, &value).await;
            Box::new(move |app: &mut App| match result {
                Ok(config) => {
                    if let Some(label) = option_of_kind(&config, "model").and_then(current_name) {
                        app.model_label = Some(label);
                    }
                    // After the model, offer its effort levels.
                    let is_model = option_of_kind(&config, "model").is_some_and(|o| o["id"] == config_id.as_str());
                    if is_model {
                        if let Some(effort) = option_of_kind(&config, "effort") {
                            app.picker = option_picker(effort, "Reasoning effort");
                        }
                    }
                }
                Err(e) => app.notice = Some(busy_message(e)),
            }) as Apply
        });
    }

    fn choose_default_model(&mut self, model: String) {
        let Some(runtime) = self.runtime.clone() else { return };
        let (api, team) = (self.api.clone(), self.team_id());
        let id = runtime["id"].as_str().unwrap_or_default().to_string();
        self.background(true, async move {
            let controls = api.runtime_models(&team, &id, Some(&model)).await.ok().map(|c| c["controls"].clone());
            Box::new(move |app: &mut App| app.show_default_efforts(&runtime, model, controls)) as Apply
        });
    }

    fn show_default_efforts(&mut self, runtime: &Value, model: String, controls: Option<Value>) {
        let efforts: Vec<Value> = controls
            .as_ref()
            .and_then(|c| c["effort"].as_array())
            .map(|a| a.iter().filter(|o| o["value"] != "default").cloned().collect())
            .unwrap_or_default();
        if efforts.is_empty() {
            return self.save_defaults(json!({ "model": model }));
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

    fn save_defaults(&mut self, defaults: Value) {
        let Some(runtime) = self.runtime.clone() else { return };
        let (api, team) = (self.api.clone(), self.team_id());
        let id = runtime["id"].as_str().unwrap_or_default().to_string();
        self.background(true, async move {
            let result = api.set_runtime_defaults(&team, &id, &defaults).await;
            Box::new(move |app: &mut App| match result {
                Ok(_) => {
                    if let Some(r) = app.runtime.as_mut().filter(|r| r["id"] == runtime["id"]) {
                        r["defaults"] = defaults;
                    }
                    app.model_label = app.runtime_default_model();
                    app.reload_runtimes();
                }
                Err(e) => app.notice = Some(e.message),
            }) as Apply
        });
    }

    // MARK: - Teams

    fn open_team_picker(&mut self) {
        let api = self.api.clone();
        self.background(true, async move {
            let result = api.teams().await;
            Box::new(move |app: &mut App| match result {
                Ok(teams) => {
                    let selected = teams.iter().position(|t| t["id"] == app.team["id"]).unwrap_or(0);
                    let items = teams.into_iter().map(|t| (shared::label(&t), String::new(), t)).collect();
                    app.picker =
                        Some(Picker { title: "Switch team".into(), items, selected, action: PickAction::Team });
                }
                Err(e) => app.notice = Some(e.message),
            }) as Apply
        });
    }

    fn choose_team(&mut self, team: Value) {
        if team["id"] == self.team["id"] {
            return;
        }
        shared::remember_team(&mut self.prefs, &team);
        self.team = team;
        self.sessions.clear();
        self.shared_sessions.clear();
        self.favorites = json!({ "entries": [] });
        self.runtimes.clear();
        self.runtime = None;
        self.messages.clear();
        self.new_conversation();
        self.fetch_sessions();
        self.reload_runtimes();
    }

    // MARK: - Resume

    /// Opens Sessions at once with the list from last time, and fetches a
    /// fresh one in the background.
    fn open_conversation_picker(&mut self) {
        self.fetch_sessions();
        self.picker = Some(Picker {
            title: "Sessions".into(),
            items: self.session_items(),
            selected: 0,
            action: PickAction::Conversation,
        });
    }

    fn fetch_sessions(&mut self) {
        if self.sessions_loading {
            return;
        }
        self.sessions_loading = true;
        let (api, team) = (self.api.clone(), self.team_id());
        self.background(false, async move {
            let (mine, shared, favorites) = tokio::join!(
                api.conversations(&team, "mine"),
                api.conversations(&team, "shared"),
                api.favorites(&team)
            );
            Box::new(move |app: &mut App| {
                app.sessions_loading = false;
                if app.team_id() != team {
                    return app.fetch_sessions();
                }
                match mine {
                    Ok(list) => app.sessions = list,
                    Err(e) => return app.notice = Some(e.message),
                }
                // Older servers have neither; the list still works without them.
                app.shared_sessions = shared.unwrap_or_default();
                if let Ok(favorites) = favorites {
                    app.favorites = favorites;
                }
                app.refresh_session_picker();
            }) as Apply
        });
    }

    /// Rebuilds an open Sessions page, keeping the same conversation selected.
    fn refresh_session_picker(&mut self) {
        let items = self.session_items();
        if let Some(picker) = self.picker.as_mut().filter(|p| matches!(p.action, PickAction::Conversation)) {
            let current = picker.items.get(picker.selected).map(|(_, _, c)| c["sessionId"].clone());
            picker.selected = items.iter().position(|(_, _, c)| Some(&c["sessionId"]) == current.as_ref()).unwrap_or(0);
            picker.items = items;
        }
    }

    /// As in the desktop's sidebar: Pinned, then Shared, then my Chats, a
    /// pinned conversation only once. Each row carries its section.
    fn session_items(&self) -> Vec<(String, String, Value)> {
        let entries = self.favorites["entries"].as_array().cloned().unwrap_or_default();
        let pinned: Vec<(String, Value)> =
            entries.iter().filter_map(|e| shared::pinned_session(e).map(|id| (id, e.clone()))).collect();
        let is_pinned = |c: &Value| pinned.iter().any(|(id, _)| c["sessionId"] == id.as_str());
        let known =
            |id: &str| self.sessions.iter().chain(&self.shared_sessions).find(|c| c["sessionId"] == id).cloned();
        let mut rows = Vec::new();
        for (id, entry) in &pinned {
            let c = known(id).unwrap_or_else(|| json!({ "sessionId": id, "title": entry["label"] }));
            rows.push(("Pinned", c));
        }
        rows.extend(self.shared_sessions.iter().filter(|c| !is_pinned(c)).map(|c| ("Shared", c.clone())));
        rows.extend(self.sessions.iter().filter(|c| !is_pinned(c)).map(|c| ("Chats", c.clone())));
        rows.into_iter()
            .map(|(section, mut c)| {
                let mut detail = shared::conversation_time(&c);
                if c["isOwner"] == false {
                    if let Some(owner) = c["owner"]["name"].as_str() {
                        detail = format!("{} · {detail}", render::clean(owner));
                    }
                }
                c["section"] = json!(section);
                (shared::conversation_title(&c), detail, c)
            })
            .collect()
    }

    /// `p` on Sessions: pins or unpins the selected conversation, in the same
    /// favorites the desktop's sidebar shows. The page changes at once.
    fn toggle_pin(&mut self) {
        let Some((title, _, c)) = self.picker.as_ref().and_then(|p| p.items.get(p.selected)).cloned() else { return };
        let id = c["sessionId"].as_str().unwrap_or_default().to_string();
        let mut entries = self.favorites["entries"].as_array().cloned().unwrap_or_default();
        let before = entries.len();
        entries.retain(|e| shared::pinned_session(e).as_deref() != Some(id.as_str()));
        if entries.len() == before {
            entries.push(json!({ "label": title, "href": format!("/teams/{}/agent/{id}", self.team_id()) }));
        }
        let revision = self.favorites["revision"].clone();
        self.favorites["entries"] = json!(entries);
        self.refresh_session_picker();
        let (api, team) = (self.api.clone(), self.team_id());
        self.background(false, async move {
            let result = api.set_favorites(&team, &json!(entries), &revision).await;
            Box::new(move |app: &mut App| match result {
                Ok(saved) if app.team_id() == team => app.favorites = saved,
                Ok(_) => {}
                // Changed elsewhere meanwhile (409), or failed: show what the server has.
                Err(e) => {
                    app.notice = Some(format!("Could not update pins: {}", e.message));
                    app.fetch_sessions();
                }
            }) as Apply
        });
    }

    /// Switches to the conversation at once and loads it in the background.
    fn resume(&mut self, summary: Value) {
        let Some(id) = summary["sessionId"].as_str().map(String::from) else { return };
        self.new_conversation();
        self.session_id = id.clone();
        self.is_new = false;
        self.title = Some(shared::conversation_title(&summary)).filter(|t| t != "Untitled chat");
        self.model_label = None;
        self.loading = true;
        let (api, team) = (self.api.clone(), self.team_id());
        self.background(false, async move {
            let detail = api.conversation(&team, &id).await;
            let config = api.model_config(&team, &id).await.ok();
            Box::new(move |app: &mut App| {
                if app.session_id == id {
                    app.loading = false;
                    app.show_conversation(detail, config);
                }
            }) as Apply
        });
    }

    fn show_conversation(&mut self, detail: Result<Value, ApiError>, config: Option<Value>) {
        let detail = match detail {
            Ok(d) => d,
            Err(e) => return self.notice = Some(e.message),
        };
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
        self.model_label = config.as_ref().and_then(|c| option_of_kind(c, "model")).and_then(current_name);
        self.follow(&detail);
    }

    /// Archives this conversation and starts a new one; the request finishes
    /// in the background and only reports back if it fails.
    fn archive(&mut self) {
        if self.is_new {
            return self.notice = Some("Nothing to archive yet.".into());
        }
        let (api, team, id) = (self.api.clone(), self.team_id(), self.session_id.clone());
        self.sessions.retain(|c| c["sessionId"] != id.as_str());
        self.new_conversation();
        self.notice = Some("Archived.".into());
        self.background(false, async move {
            let result = api.archive(&team, &id).await;
            Box::new(move |app: &mut App| {
                if let Err(e) = result {
                    app.notice = Some(format!("Could not archive: {}", e.message));
                }
            }) as Apply
        });
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
    fn poll(&mut self) {
        if self.is_new || self.stream.is_some() || self.picker.is_some() || self.loading || self.polling {
            return;
        }
        self.polling = true;
        let (api, team, session) = (self.api.clone(), self.team_id(), self.session_id.clone());
        self.background(false, async move {
            let detail = api.conversation(&team, &session).await;
            Box::new(move |app: &mut App| {
                app.polling = false;
                match detail {
                    Ok(detail) if app.session_id == session && app.stream.is_none() => app.follow(&detail),
                    _ => {}
                }
            }) as Apply
        });
    }

    /// Runs a request off the event loop and applies its result when it
    /// returns, so the screen never waits on the network. `busy` shows the
    /// spinner meanwhile.
    fn background(&mut self, busy: bool, request: impl Future<Output = Apply> + Send + 'static) {
        self.busy += usize::from(busy);
        let tx = self.apply_tx.clone();
        tokio::spawn(async move {
            let apply = request.await;
            let _ = tx.send(Box::new(move |app: &mut App| {
                app.busy -= usize::from(busy);
                apply(app);
            }));
        });
    }

    // MARK: - Picker

    async fn on_picker_key(&mut self, key: KeyEvent) {
        let Some(picker) = self.picker.as_mut() else { return };
        match key.code {
            KeyCode::Up => picker.selected = picker.selected.saturating_sub(1),
            KeyCode::Down => picker.selected = (picker.selected + 1).min(picker.items.len().saturating_sub(1)),
            KeyCode::Esc => self.picker = None,
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => self.picker = None,
            KeyCode::Char('p') if matches!(picker.action, PickAction::Conversation) => self.toggle_pin(),
            KeyCode::Char('l') if matches!(picker.action, PickAction::Runtime) => {
                let Some((_, _, agent)) = picker.items.get(picker.selected).cloned() else { return };
                if agent["add"].is_null() {
                    self.picker = None;
                    self.sign_in_agent(agent);
                }
            }
            KeyCode::Enter => {
                let Some(picker) = self.picker.take() else { return };
                let Some((_, _, value)) = picker.items.into_iter().nth(picker.selected) else { return };
                match picker.action {
                    PickAction::Team => self.choose_team(value),
                    PickAction::Runtime => match value["add"].as_str() {
                        Some(kind) => self.add_agent(kind),
                        None => self.choose_runtime(value),
                    },
                    PickAction::Conversation => self.resume(value),
                    PickAction::SessionOption { config_id } => self.choose_session_option(config_id, value),
                    PickAction::DefaultModel => {
                        self.choose_default_model(value.as_str().unwrap_or_default().to_string())
                    }
                    PickAction::DefaultEffort { model } => {
                        self.save_defaults(json!({ "model": model, "effort": value }))
                    }
                }
            }
            _ => {}
        }
    }
}

/// The sessions page: Pinned, Shared and Chats, each row with how long ago
/// it was active (and, if shared, whose it is) on the right; ● is running.
fn session_lines(picker: &Picker, area: Rect, empty: &'static str) -> Vec<Line<'static>> {
    let width = area.width as usize;
    let mut lines = vec![Line::from(Span::styled("Sessions", Style::default().add_modifier(Modifier::BOLD)))];
    if picker.items.is_empty() {
        lines.extend([Line::default(), Line::from(Span::styled(empty, dim()))]);
    }
    let mut rows = Vec::new();
    let mut group = None;
    for (i, (title, detail, c)) in picker.items.iter().enumerate() {
        let running = !c["activeRun"].is_null();
        let section = c["section"].as_str().unwrap_or_default().to_string();
        if group.as_ref() != Some(&section) {
            rows.push((None, Line::default()));
            rows.push((None, Line::from(Span::styled(section.clone(), dim()))));
            group = Some(section);
        }
        let selected = i == picker.selected;
        let time = detail.clone();
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

/// Only web pages are opened; anything else is just shown.
fn open_https(url: &str) {
    if url.starts_with("https://") {
        let _ = open::that(url);
    }
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
