#[cfg(feature = "acp")]
#[allow(clippy::all, dead_code, unused)]
pub mod acp_schema;
#[cfg(feature = "acp")]
pub mod acp_server;
#[cfg(feature = "feishu")]
pub mod feishu;
#[cfg(feature = "feishu")]
pub mod feishu_card;
#[cfg(feature = "googlechat")]
pub mod googlechat;
#[cfg(feature = "line")]
pub mod line;
#[cfg(feature = "lineworks")]
pub mod lineworks;
#[cfg(feature = "lineworks")]
pub mod lineworks_flex;
#[cfg(feature = "acp")]
pub mod runtime_console;
#[cfg(feature = "acp")]
pub mod runtime_console_ui;
#[cfg(feature = "acp")]
pub mod runtime_credentials;
#[cfg(feature = "acp")]
pub mod runtime_pairing;
#[cfg(feature = "teams")]
pub mod teams;
#[cfg(feature = "telegram")]
pub mod telegram;
#[cfg(feature = "wecom")]
pub mod wecom;

#[cfg(feature = "acp")]
pub mod session_snapshot;

#[cfg(feature = "acp")]
pub mod session_owners;

#[cfg(feature = "acp")]
pub mod session_requests;

#[cfg(feature = "acp")]
pub mod session_operations;
