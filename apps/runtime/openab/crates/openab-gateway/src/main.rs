//! Standalone gateway binary — thin wrapper around `openab_gateway::serve()`.

use anyhow::Result;
use openab_gateway::ServeConfig;

#[tokio::main]
async fn main() -> Result<()> {
    // rustls can't pick a default provider when ring and aws-lc-rs are both compiled in.
    let _ = rustls::crypto::ring::default_provider().install_default();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    openab_gateway::serve(ServeConfig::default()).await
}
