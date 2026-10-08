import { Container } from '@cloudflare/containers'
import { containerEnv, type Settings } from './config'

interface Env extends Settings {
  BACKEND: DurableObjectNamespace<NuphosBackend>
}

export class NuphosBackend extends Container<Env> {
  defaultPort = 3000
  sleepAfter = '1h'
  envVars = containerEnv(this.env)

  // Background conversations can be active without incoming HTTP traffic.
  // Keep the singleton alive; deployments/platform restarts can still stop it.
  override async onActivityExpired() {}
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.BACKEND.getByName('backend').fetch(request)
  },
} satisfies ExportedHandler<Env>
