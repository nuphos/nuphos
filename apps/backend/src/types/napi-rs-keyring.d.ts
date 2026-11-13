// Backend tests import desktop local-runtime code, which reaches the desktop's
// token store. It loads this native module on first use, and only the desktop
// installs it, so the backend type-checks against the part it uses.
declare module '@napi-rs/keyring' {
  export class AsyncEntry {
    constructor(service: string, username: string, options?: unknown)
    getPassword(): Promise<string | null>
    setPassword(password: string): Promise<void>
    deletePassword(): Promise<boolean>
  }
}
