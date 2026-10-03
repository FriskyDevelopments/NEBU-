'use strict';

/**
 * rotate-oauth-tokens — offline helper to re-encrypt stored OAuth token
 * envelopes under the current active key.
 *
 * This script does NOT connect to any database, network, or deployment. It
 * reads envelope strings from stdin (one per line) and prints the rotated
 * envelope for each. Pipe your exported ciphertext through it, then write the
 * output back to your store with your own tooling. This keeps the security
 * change small and reviewable, and avoids any destructive/live action.
 *
 * Usage (keys loaded from the environment — never pass real keys on argv):
 *
 *   # 1. Add a NEW active key in front of the existing one so both are known:
 *   export NEBULOSA_TOKEN_ENC_KEYS="k2:<base64-32B>,k1:<base64-32B>"
 *
 *   # 2. Rotate exported envelopes (one per line) to the new active key:
 *   cat exported-tokens.txt | node scripts/rotate-oauth-tokens.cjs > rotated.txt
 *
 *   # 3. Persist rotated.txt back into storage, then retire k1 once confirmed.
 *
 * Flags:
 *   --allow-plaintext   Treat non-envelope input lines as legacy plaintext and
 *                       encrypt them (first-time migration). Off by default so
 *                       malformed input fails loudly.
 *   --help              Show this message.
 *
 * Exit codes: 0 success, 1 configuration/usage error, 2 per-line failure.
 */

const readline = require('readline');
const path = require('path');
const { createTokenCipher } = require(path.join(__dirname, '..', 'server', 'nebulosa', 'token-crypto.cjs'));

function printHelp() {
  process.stdout.write(
    [
      'rotate-oauth-tokens — re-encrypt stored OAuth token envelopes to the active key.',
      '',
      'Keys are read from NEBULOSA_TOKEN_ENC_KEYS ("keyId:base64key[,keyId:base64key]").',
      'The first key is active (used to encrypt); all listed keys can decrypt.',
      '',
      'Reads envelopes from stdin (one per line), writes rotated envelopes to stdout.',
      '',
      'Flags: --allow-plaintext  encrypt legacy plaintext lines (migration)',
      '       --help             show this message',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }
  const allowPlaintextMigration = args.includes('--allow-plaintext');

  let cipher;
  try {
    cipher = createTokenCipher();
  } catch (err) {
    process.stderr.write(`[config error] ${err.message}\n`);
    process.stderr.write('Set NEBULOSA_TOKEN_ENC_KEYS before running. Never commit real keys.\n');
    return 1;
  }

  process.stderr.write(
    `[info] active key: ${cipher.activeKeyId}; known keys: ${cipher.knownKeyIds().join(', ')}\n`
  );

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let total = 0;
  let rotated = 0;
  let failures = 0;

  for await (const line of rl) {
    const value = line.trim();
    if (value === '') continue;
    total += 1;
    try {
      const result = cipher.rotate(value, { allowPlaintextMigration });
      if (result.rotated) rotated += 1;
      process.stdout.write(result.value + '\n');
    } catch (err) {
      failures += 1;
      // Never echo the offending value — it may be sensitive. Report by index.
      process.stderr.write(`[error] line ${total}: ${err.message}\n`);
    }
  }

  process.stderr.write(
    `[done] processed=${total} rotated=${rotated} unchanged=${total - rotated - failures} failures=${failures}\n`
  );
  return failures > 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[fatal] ${err.message}\n`);
    process.exit(1);
  });
