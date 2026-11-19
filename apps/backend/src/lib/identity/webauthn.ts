// The WebAuthn verification, in one module the tests can double
// (lib/test/doubles/webauthn.ts): the cryptography is @simplewebauthn/server's.
export {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
