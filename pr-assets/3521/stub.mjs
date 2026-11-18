// The only Nuphos endpoints the host asks before it can run: who owns it, and the newest CLI
// (answered with the true newest release). Everything else the host dials simply fails here.
import { createServer } from 'node:http'
createServer((req, res) => {
  if (req.url === '/auth/me') return res.end(JSON.stringify({ id: 'e2e-owner', name: 'E2E' }))
  if (req.url === '/cli/latest') return res.end('0.22.0\n')
  res.statusCode = 404
  res.end('{}')
}).listen(8787, '127.0.0.1')
