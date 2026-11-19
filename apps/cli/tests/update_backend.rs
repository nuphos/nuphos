use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::Command;
use std::time::{Duration, Instant};

#[test]
fn update_asks_the_configured_backend_for_the_release() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let receiver = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Ok((mut stream, _)) = listener.accept() {
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut bytes = [0; 4096];
                let len = stream.read(&mut bytes).unwrap();
                let request = String::from_utf8_lossy(&bytes[..len]).to_string();
                // A deliberately old release avoids running an installer.
                stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\n0.0.1\n").unwrap();
                return request;
            }
            assert!(Instant::now() < deadline, "no request reached the configured backend");
            std::thread::sleep(Duration::from_millis(10));
        }
    });
    let home = std::env::temp_dir().join(format!("nuphos-update-test-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_nuphos"))
        .arg("update")
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", &home)
        .env("NUPHOS_CLI_CONFIG", home.join("cli.yaml"))
        .env("NUPHOS_API_URL", format!("http://{address}/"))
        // Trap an old hardcoded HTTPS target locally instead of reaching Cloud.
        .env("HTTPS_PROXY", format!("http://{address}"))
        .env("NO_PROXY", "127.0.0.1")
        .output()
        .unwrap();
    let request = receiver.join().unwrap();
    std::fs::remove_dir_all(home).unwrap();
    assert!(
        request.starts_with("GET /cli/latest HTTP/1.1\r\n"),
        "unexpected request: {}",
        request.lines().next().unwrap_or_default()
    );
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    assert!(String::from_utf8_lossy(&output.stdout).contains("is up to date"));
}
