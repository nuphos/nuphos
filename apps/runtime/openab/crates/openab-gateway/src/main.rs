//! Standalone gateway binary — thin wrapper around `openab_gateway::serve()`.

use anyhow::Result;
use openab_gateway::ServeConfig;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    openab_gateway::serve(ServeConfig::default()).await
}
