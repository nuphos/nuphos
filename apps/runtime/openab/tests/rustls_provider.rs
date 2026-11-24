//! Guards the crypto provider install at the top of `main` (here and in openab-gateway).
//!
//! This binary links the same rustls feature set as `openab`, where both ring and
//! aws-lc-rs are compiled in. rustls then picks no process default, so
//! `ClientConfig::builder()` (used by tokio-tungstenite's wss connector and by agentcore)
//! panics unless a provider was installed first.

#[test]
fn client_config_needs_the_provider_main_installs() {
    let without = std::panic::catch_unwind(rustls::ClientConfig::builder);
    assert!(
        without.is_err(),
        "rustls now picks a default provider by itself; the install in main may be unnecessary"
    );

    // Same call as `main`.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let _ = rustls::ClientConfig::builder()
        .with_root_certificates(rustls::RootCertStore::empty())
        .with_no_client_auth();
}
