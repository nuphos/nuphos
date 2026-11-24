//! Guards the crypto provider install at the top of `main`.
//!
//! `openab` links rustls with both ring and aws-lc-rs (the AWS SDK brings aws-lc-rs), so
//! rustls picks no process default and `ClientConfig::builder()` panics unless `main`
//! installed one. This runs the real binary against a loopback port as its gateway and
//! checks that a TLS ClientHello arrives. Without the install the wss connector panics
//! after the TCP connect and nothing is sent.

use std::io::Read;
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[test]
fn gateway_wss_sends_a_tls_client_hello() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config.toml");
    std::fs::write(
        &config,
        format!("[gateway]\nurl = \"wss://127.0.0.1:{port}\"\nplatform = \"telegram\"\n"),
    )
    .unwrap();

    let mut child = Command::new(env!("CARGO_BIN_EXE_openab"))
        .args(["run", "-c"])
        .arg(&config)
        .current_dir(dir.path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();

    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    let first = loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut byte = [0u8; 1];
                break stream
                    .read(&mut byte)
                    .ok()
                    .filter(|&n| n == 1)
                    .map(|_| byte[0]);
            }
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => break None,
        }
    };
    let _ = child.kill();
    let _ = child.wait();

    // 0x16 is the TLS handshake record type.
    assert_eq!(
        first,
        Some(0x16),
        "no TLS ClientHello; is the provider install in main gone?"
    );
}
