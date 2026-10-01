const baseUrl = process.env.DATABASE_TAILSCALE_DIALER_URL

if (!baseUrl) {
  process.exit(0)
}

const deadline = Date.now() + 60_000
const healthUrl = new URL('/healthz', baseUrl)

while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(1_000),
    })

    if (response.ok) {
      process.exit(0)
    }
  } catch {
    // The rootless dialer may still be compiling or starting. Retry without
    // logging response bodies, which keeps its control plane opaque here.
  }

  await Bun.sleep(250)
}

console.error('Tailscale database dialer did not become ready within 60 seconds')
process.exit(1)
