# OAuth Token Encryption & Rotation

Stored OAuth tokens (for example the Zoom `access_token` / `refresh_token`
persisted alongside each Telegram user) are sensitive bearer credentials. If
the database or an export leaks, plaintext tokens let an attacker act as the
user until the token expires or is revoked. This repo provides authenticated
encryption-at-rest for those values plus a safe key-rotation path.

> Scope: this is the crypto primitive + a safe offline rotation tool + tests.
> Wiring it into the token read/write paths (`server/storage.ts`,
> `server/routes.ts`, `bot.cjs`) is a follow-up integration step; see
> "Integration" below.

## Module

`server/nebulosa/token-crypto.cjs` — zero-dependency CommonJS, uses only Node's
built-in `crypto`.

- **Algorithm:** AES-256-GCM (authenticated; tampering is detected on decrypt).
- **Envelope (safe to store in a text column):**
  `nbenc:v1:<keyId>:<iv_b64>:<ciphertext_b64>:<tag_b64>`
- **Keyring:** a set of named keys. The **first** key is *active* (used to
  encrypt new values); **all** listed keys remain available for decryption.
  This is what makes rotation safe — you can add a new key, re-encrypt under
  it, and only retire the old key once nothing references it.

```js
const { createTokenCipher } = require('./server/nebulosa/token-crypto.cjs');
const cipher = createTokenCipher(); // reads NEBULOSA_TOKEN_ENC_KEYS

const sealed = cipher.encrypt(accessToken);   // store this string
const token  = cipher.decrypt(sealed);        // read it back
```

## Key material

Keys are read from the environment. **Never commit real keys** — load them
from your secret manager.

```
NEBULOSA_TOKEN_ENC_KEYS = "<keyId>:<base64-32-byte-key>[,<keyId>:<base64-key>...]"
```

Generate a fresh key (placeholder output — do not reuse):

```bash
node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"
```

Each key must decode to exactly 32 bytes (AES-256). Misconfiguration throws at
startup rather than silently storing plaintext.

## Safe rotation procedure

1. **Add** a new key as the active key, keeping the old one for decryption:

   ```
   NEBULOSA_TOKEN_ENC_KEYS="k2:<new-base64-key>,k1:<old-base64-key>"
   ```

2. **Re-encrypt** existing envelopes under the new active key. The offline
   helper reads envelopes from stdin and writes rotated envelopes to stdout —
   it never touches the database, network, or any deployment:

   ```bash
   cat exported-tokens.txt | node scripts/rotate-oauth-tokens.cjs > rotated.txt
   ```

   - Values already under the active key are passed through unchanged.
   - Values under `k1` are decrypted and re-encrypted under `k2`.
   - Legacy **plaintext** is only encrypted when you pass `--allow-plaintext`
     (first-time migration); otherwise malformed input fails loudly.
   - The tool never echoes the offending value on error — it reports by line
     number so secrets stay out of logs.

3. **Persist** `rotated.txt` back into storage with your own tooling.

4. **Retire** `k1` by dropping it from `NEBULOSA_TOKEN_ENC_KEYS` only after you
   have confirmed nothing is still encrypted under it. Decrypting an envelope
   whose key has been retired fails with a clear error.

## Integration (follow-up)

To encrypt tokens at the persistence boundary:

- `server/routes.ts` — before `storage.createZoomToken(...)`, wrap
  `tokenData.access_token` / `tokenData.refresh_token` with `cipher.encrypt(...)`.
- `server/storage.ts` — keep columns as text; store envelopes.
- Read paths (`getValidZoomToken` in `bot.cjs`, any API call) — `cipher.decrypt(...)`
  the stored value just before use; never log the decrypted value.

Keep tokens decrypted only in memory for the duration of a request, and prefer
Zoom's refresh-token flow (already present in `zoomAuth.js`) so stored access
tokens are short-lived.

## Tests

`server/nebulosa/token-crypto.test.cjs` (Node's `node:test`, no deps):

```bash
node --test server/nebulosa/token-crypto.test.cjs
```

Covered: round-trip, random-IV uniqueness, tamper detection, rotation to a new
key, no-op when already current, plaintext migration gating, retired-key
failure, envelope classification, keyring misconfiguration, and input
validation. CI runs these on Node 18/20/22 via
`.github/workflows/token-crypto.yml`.
