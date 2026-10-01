import { execFile } from 'node:child_process'

import type { CloudCliProvider } from '../../src/lib/cloudCli.ts'

const VERSION_ARGS: Record<CloudCliProvider, string[]> = {
  aws: ['--version'],
  gcp: ['--version'],
  azure: ['--version'],
  aliyun: ['version'],
  tencent: ['--version'],
  volcengine: ['--version'],
  huawei: ['version'],
}

/** Read only a bounded version response from the exact executable found on PATH. */
export function readCloudCliVersion(
  provider: CloudCliProvider,
  executable: string,
  env: NodeJS.ProcessEnv,
  timeout = 5_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      executable,
      VERSION_ARGS[provider],
      { env, timeout, killSignal: 'SIGKILL', maxBuffer: 32 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return resolve(null)
        // Ignore dependency versions and warnings elsewhere in the output.
        const patterns: Record<CloudCliProvider, RegExp> = {
          aws: /aws-cli\/([^\s]+)/,
          gcp: /Google Cloud SDK\s+([^\s]+)/,
          azure: /azure-cli\s+([^\s]+)/,
          aliyun: /^[ \t]{0,16}(?:Alibaba Cloud CLI\s+)?v?(\d+\.\d+\.\d+[\w.+-]*)/im,
          tencent: /(?:^|\n)[ \t]{0,16}(?:tccli\s+)?v?(\d+\.\d+\.\d+[\w.+-]*)/i,
          volcengine:
            /(?:^|\n)[ \t]{0,16}(?:(?:ve|volcengine-cli)(?:\s+version)?[ :]{1,16})?v?(\d+\.\d+\.\d+[\w.+-]*)/i,
          huawei:
            /(?:^|\n)[ \t]{0,16}(?:(?:hcloud|Current Cloud CLI)(?:\s+version)?[ :]{1,16})?v?(\d+\.\d+\.\d+[\w.+-]*)/i,
        }

        resolve(`${stdout}\n${stderr}`.match(patterns[provider])?.[1]?.slice(0, 80) ?? null)
      },
    )

    child.stdin?.end()
  })
}
