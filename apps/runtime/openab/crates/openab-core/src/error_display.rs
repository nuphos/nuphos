use crate::acp::connection::AcpRequestError;
use crate::acp::pool::SessionStartError;
use std::io::ErrorKind;

/// Format a session start failure for user display in Discord.
///
/// Causes the runtime knows are matched by variant. Only the agent's own text
/// (an agent error's message, or an untyped failure) is read for a disk-full or
/// sign-in cause; anything else is passed through verbatim.
pub fn format_user_error(e: &SessionStartError) -> String {
    let auth_required = match e {
        SessionStartError::Request(AcpRequestError::Timeout { method }) => {
            return format!("**Request Timeout**\nTimeout waiting for {method}, please try again.");
        }
        SessionStartError::Request(AcpRequestError::ConnectionClosed { .. }) => {
            return "**Connection Lost**\nThe connection to the agent was lost, please try again."
                .to_string();
        }
        SessionStartError::PoolExhausted(_) => {
            return "**Service Busy**\nAll agent sessions are in use, please try again shortly."
                .to_string();
        }
        SessionStartError::Spawn { source, .. } if source.kind() != ErrorKind::StorageFull => {
            return "**Agent Not Found**\nCould not start the agent — please check your configuration."
                .to_string();
        }
        SessionStartError::Request(AcpRequestError::Agent(err))
            if err.code == -32603
                && err.message.trim() == "Internal error"
                && err.data_message().is_none() =>
        {
            return "**Internal Error** (code: -32603)\nThe agent failed without reporting a reason. \
                    Try again; if it keeps happening, check the agent's logs or switch to another \
                    runtime."
                .to_string();
        }
        // ACP `auth_required`.
        SessionStartError::Request(AcpRequestError::Agent(err)) => {
            err.code == -32000
                && err
                    .message
                    .to_lowercase()
                    .contains("authentication required")
        }
        _ => false,
    };

    let message = e.to_string();
    let msg_lower = message.to_lowercase();
    // `ENOSPC` is an errno, not prose, so it names a fix reliably; the raw cause stays quoted.
    let disk_full = matches!(e, SessionStartError::Spawn { source, .. } if source.kind() == ErrorKind::StorageFull)
        || msg_lower.contains("enospc")
        || msg_lower.contains("no space left on device");
    if disk_full {
        return format!(
            "**Disk Full**\nThe machine running the agent is out of disk space, so the agent \
             could not start. Free up disk space there or switch to another runtime, then try \
             again.\n> {message}"
        );
    }
    if auth_required || is_sign_in_notice(&msg_lower) {
        return format!(
            "**Sign-in Required**\nThe agent's sign-in with its model provider is missing or no \
             longer valid, so it could not start. Sign the agent in again (or update its API \
             key), then try again.\n> {message}"
        );
    }

    if message.is_empty() {
        "**Error**\nAn unknown error occurred.".to_string()
    } else {
        format!("**Error**\n{}", message)
    }
}

/// Claude Code's own sign-in notices and the plain 401s this branch always covered.
/// Free-text guesses (e.g. "token expired") stay unmatched.
fn is_sign_in_notice(msg_lower: &str) -> bool {
    [
        "failed to authenticate",
        "please run /login",
        "invalid api key",
        "unauthorized",
    ]
    .iter()
    .any(|needle| msg_lower.contains(needle))
}

/// Format coded error from ACP agent for display in Discord.
/// Used for response errors that have a JSON-RPC or HTTP status code.
/// `data_message` is the optional detail extracted from `error.data.message`.
/// Public for reuse by other adapters (e.g. Slack).
pub fn format_coded_error(code: i64, message: &str, data_message: Option<&str>) -> String {
    let prefix = match code {
        400 => "**Bad Request**",
        401 => "**Unauthorized**",
        403 => "**Forbidden**",
        404 => "**Not Found**",
        408 => "**Request Timeout**",
        429 => "**Rate Limited**",
        500 => "**Internal Server Error**",
        502 => "**Bad Gateway**",
        503 => "**Service Unavailable**",
        504 => "**Gateway Timeout**",
        -32600 => "**Invalid Request**",
        -32601 => "**Method Not Found**",
        -32602 => "**Invalid Params**",
        -32603 => "**Internal Error**",
        -32099..=-32000 => "**Server Error**",
        _ => "**Error**",
    };
    let mut out = if message.is_empty() {
        format!("{} (code: {})", prefix, code)
    } else {
        format!("{} (code: {})\n{}", prefix, code, message)
    };
    let detail = data_message.filter(|s| !s.trim().is_empty());
    if let Some(detail) = detail {
        if !message.contains(detail) {
            out.push_str("\n> ");
            out.push_str(detail);
        }
    } else if code == -32603
        && message
            .trim()
            .trim_start_matches("Internal error")
            .is_empty()
    {
        // Only a bare "Internal error" lacks details; a message that names the cause has them.
        out.push_str(
            "\n\n_The agent did not return any error details. \
             Please check the agent's own logs for more information._",
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── format_user_error tests ─────────────────────────────────────────────

    use crate::acp::protocol::JsonRpcError;

    fn agent(code: i64, message: &str, detail: Option<&str>) -> SessionStartError {
        AcpRequestError::from(JsonRpcError {
            code,
            message: message.into(),
            data: detail.map(|d| serde_json::json!({ "message": d })),
        })
        .into()
    }

    fn text(message: &str) -> SessionStartError {
        anyhow::anyhow!("{message}").into()
    }

    #[test]
    fn format_user_error_timeout() {
        let e = AcpRequestError::Timeout {
            method: "session/new".into(),
        };
        let result = format_user_error(&e.into());
        assert!(result.contains("Request Timeout"));
        assert!(result.contains("session/new"));
    }

    #[test]
    fn format_user_error_connection_closed() {
        let e = AcpRequestError::ConnectionClosed {
            method: "initialize".into(),
        };
        assert!(format_user_error(&e.into()).contains("Connection Lost"));
    }

    #[test]
    fn format_user_error_failed_to_spawn() {
        let e = SessionStartError::Spawn {
            command: "/some/path".into(),
            source: std::io::Error::from(ErrorKind::NotFound),
        };
        let result = format_user_error(&e);
        assert!(result.contains("Agent Not Found"));
        assert!(result.contains("the agent")); // generic, no provider name
    }

    #[test]
    fn format_user_error_spawn_on_a_full_disk_says_disk_full() {
        let e = SessionStartError::Spawn {
            command: "/some/path".into(),
            source: std::io::Error::from(ErrorKind::StorageFull),
        };
        assert!(format_user_error(&e).starts_with("**Disk Full**"));
    }

    #[test]
    fn format_user_error_pool_exhausted() {
        let result = format_user_error(&SessionStartError::PoolExhausted(5));
        assert!(result.contains("Service Busy"));
    }

    #[test]
    fn format_user_error_invalid_api_key() {
        assert!(format_user_error(&text("invalid api key")).contains("Sign-in Required"));
    }

    #[test]
    fn format_user_error_unauthorized() {
        let result = format_user_error(&text("unauthorized: token rejected"));
        assert!(result.contains("Sign-in Required"));
    }

    #[test]
    fn format_user_error_signed_out_agent_says_to_sign_in_again() {
        for e in [
            agent(-32000, "Authentication required", None),
            agent(
                -32603,
                "Internal error",
                Some("Invalid API key · Please run /login"),
            ),
            agent(
                -32603,
                "Internal error: Failed to authenticate. API Error: 401 OAuth token has expired",
                None,
            ),
        ] {
            let raw = e.to_string();
            let result = format_user_error(&e);
            assert!(result.starts_with("**Sign-in Required**"), "{raw}");
            assert!(result.contains("Sign the agent in again"), "{raw}");
            assert!(result.ends_with(&format!("> {raw}")), "{raw}");
        }
    }

    #[test]
    fn format_user_error_free_text_is_not_guessed_as_a_sign_in_failure() {
        for raw in [
            "prompt is too long: 210000 tokens > 200000 maximum",
            "refresh token was revoked",
            "Authentication required for MCP server github",
        ] {
            assert!(
                format_user_error(&text(raw)).starts_with("**Error**"),
                "{raw}"
            );
        }
        let other_code = agent(-32001, "Authentication required", None);
        assert!(format_user_error(&other_code).starts_with("**Error**"));
    }

    #[test]
    fn format_user_error_unknown() {
        let result = format_user_error(&text("something went wrong"));
        assert!(result.contains("Error"));
        assert!(result.contains("something went wrong"));
    }

    #[test]
    fn format_user_error_empty() {
        let result = format_user_error(&text(""));
        assert!(result.contains("Error"));
        assert!(result.contains("unknown"));
    }

    #[test]
    fn format_user_error_disk_full_names_the_fix_and_keeps_the_cause() {
        let e = agent(
            -32603,
            "Internal error",
            Some("ENOSPC: no space left on device, mkdir '/x'"),
        );
        let raw = e.to_string();
        let result = format_user_error(&e);
        assert!(result.starts_with("**Disk Full**"));
        assert!(result.contains("Free up disk space"));
        assert!(result.ends_with(&format!("> {raw}")));
    }

    #[test]
    fn format_user_error_keeps_the_adapters_own_process_death_notice() {
        let e = agent(
            -32603,
            "Internal error",
            Some(
                "Claude Code ran out of memory: this computer's agents reached their memory \
                 limit (3.6 GB) and the system stopped it. Send a message to continue.",
            ),
        );
        assert_eq!(format_user_error(&e), format!("**Error**\n{e}"));
    }

    #[test]
    fn format_user_error_bare_internal_error_says_what_to_do() {
        let result = format_user_error(&agent(-32603, "Internal error", None));
        assert!(result.starts_with("**Internal Error** (code: -32603)"));
        assert!(result.contains("without reporting a reason"));
        assert!(!result.contains("JSON-RPC error"));
    }

    #[test]
    fn format_user_error_internal_error_with_detail_passes_it_through() {
        let e = agent(-32603, "Internal error", Some("model not found"));
        assert_eq!(format_user_error(&e), format!("**Error**\n{e}"));
    }

    #[test]
    fn format_user_error_matches_by_variant_not_by_wording() {
        let reworded = text("timeout waiting for session/new response");
        assert!(format_user_error(&reworded).starts_with("**Error**"));
    }

    // ─── format_coded_error tests ───────────────────────────────────────────

    #[test]
    fn format_coded_error_401() {
        let result = format_coded_error(401, "invalid token", None);
        assert!(result.contains("Unauthorized"));
        assert!(result.contains("401"));
        assert!(result.contains("invalid token"));
    }

    #[test]
    fn format_coded_error_429() {
        let result = format_coded_error(429, "", None);
        assert!(result.contains("Rate Limited"));
        assert!(result.contains("429"));
        assert!(!result.contains("\n")); // no message, no newline
    }

    #[test]
    fn format_coded_error_503() {
        let result = format_coded_error(503, "service unavailable", None);
        assert!(result.contains("Service Unavailable"));
        assert!(result.contains("503"));
        assert!(result.contains("service unavailable"));
    }

    #[test]
    fn format_coded_error_json_rpc() {
        let result = format_coded_error(-32602, "missing required parameter", None);
        assert!(result.contains("Invalid Params"));
        assert!(result.contains("-32602"));
    }

    #[test]
    fn format_coded_error_server_error_range() {
        let result = format_coded_error(-32050, "internal failure", None);
        assert!(result.contains("Server Error"));
        assert!(result.contains("-32050"));
    }

    #[test]
    fn format_coded_error_connection_error() {
        let result = format_coded_error(-32000, "connection refused", None);
        assert!(result.contains("Server Error")); // -32000 falls in -32099..=-32000 range
        assert!(result.contains("-32000"));
    }

    #[test]
    fn format_coded_error_unknown_code() {
        let result = format_coded_error(999, "something happened", None);
        assert!(result.contains("Error"));
        assert!(result.contains("999"));
        assert!(result.contains("something happened"));
    }

    #[test]
    fn format_coded_error_with_data_message() {
        let result = format_coded_error(-32603, "Internal error", Some("model not supported"));
        assert!(result.contains("Internal Error"));
        assert!(result.contains("model not supported"));
    }

    #[test]
    fn format_coded_error_data_message_not_duplicated() {
        // If data_message is already in message, don't repeat it
        let result = format_coded_error(-32603, "model not supported", Some("model not supported"));
        assert_eq!(result.matches("model not supported").count(), 1);
    }

    #[test]
    fn format_coded_error_32603_no_detail_shows_fallback() {
        let result = format_coded_error(-32603, "Internal error", None);
        assert!(result.contains("Internal Error"));
        assert!(result.contains("did not return any error details"));
        assert!(result.contains("agent's own logs"));
    }

    #[test]
    fn format_coded_error_32603_with_detail_no_fallback() {
        let result = format_coded_error(-32603, "Internal error", Some("model not found"));
        assert!(result.contains("model not found"));
        assert!(!result.contains("did not return any error details"));
    }

    #[test]
    fn format_coded_error_32603_empty_detail_shows_fallback() {
        let result = format_coded_error(-32603, "Internal error", Some(""));
        assert!(result.contains("did not return any error details"));
    }

    #[test]
    fn format_coded_error_32603_message_with_cause_no_fallback() {
        let result = format_coded_error(
            -32603,
            "Internal error: Claude Code stopped unexpectedly (terminated by signal SIGKILL).",
            None,
        );
        assert!(result.contains("SIGKILL"));
        assert!(!result.contains("did not return any error details"));
    }

    #[test]
    fn format_coded_error_other_code_no_detail_no_fallback() {
        // Fallback only applies to -32603
        let result = format_coded_error(-32602, "bad params", None);
        assert!(!result.contains("did not return any error details"));
    }

    #[test]
    fn format_coded_error_32603_empty_message_still_shows_fallback() {
        // Even when message is empty, fallback should appear
        let result = format_coded_error(-32603, "", None);
        assert!(result.contains("Internal Error"));
        assert!(result.contains("did not return any error details"));
    }

    #[test]
    fn format_coded_error_32603_whitespace_detail_shows_fallback() {
        // Whitespace-only detail should be treated as empty
        let result = format_coded_error(-32603, "Internal error", Some("   "));
        assert!(result.contains("Internal Error"));
        assert!(result.contains("did not return any error details"));
    }

    #[test]
    fn format_coded_error_500_no_detail_no_fallback() {
        // HTTP 500 without detail should NOT get the ACP-specific hint
        let result = format_coded_error(500, "server error", None);
        assert!(result.contains("Internal Server Error"));
        assert!(!result.contains("did not return any error details"));
    }

    #[test]
    fn format_coded_error_32603_fallback_does_not_duplicate_with_detail() {
        // When detail is present, no fallback appears — mutually exclusive
        let result = format_coded_error(-32603, "Internal error", Some("rate limit exceeded"));
        assert!(result.contains("rate limit exceeded"));
        assert!(!result.contains("did not return any error details"));
        assert!(!result.contains("agent's own logs"));
    }

    #[test]
    fn format_coded_error_server_error_range_no_fallback() {
        // Other JSON-RPC server error codes should NOT get the hint
        let result = format_coded_error(-32099, "custom error", None);
        assert!(!result.contains("did not return any error details"));
    }

    #[test]
    fn format_coded_error_32603_fallback_message_is_italic() {
        // Verify Discord markdown italic formatting
        let result = format_coded_error(-32603, "Internal error", None);
        assert!(result.contains("_The agent did not return"));
        assert!(result.ends_with("_"));
    }
}
