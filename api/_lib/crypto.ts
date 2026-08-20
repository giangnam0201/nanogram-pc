/* Encryption for delegated host credentials.
 *
 * A room whose host opted into "keep building while I'm away" stores that
 * host's Nanogram refresh token so the server can act for them. That token is
 * full account access, so it is never stored in the clear: AES-256-GCM with a
 * key that lives only in the environment, so a leaked Redis dump is inert on
 * its own.
 *
 * Fails closed. With no key configured, delegation cannot be armed at all
 * rather than silently degrading to plaintext.
 */

const KEY_ENV = process.env.ROOM_DELEGATION_KEY;

export const canDelegate = Boolean(KEY_ENV && KEY_ENV.length >= 32);

export class DelegationUnavailable extends Error {
  constructor() {
    super('delegation is not configured on this deployment');
  }
}

let keyPromise: Promise<CryptoKey> | null = null;

function importKey(): Promise<CryptoKey> {
  if (!canDelegate) throw new DelegationUnavailable();
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    // Accept any sufficiently long secret; hash it to exactly 256 bits.
    const material = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(KEY_ENV as string),
    );
    return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  })();
  return keyPromise;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/* Backed by a plain ArrayBuffer, not ArrayBufferLike: WebCrypto's BufferSource
   will not accept a view that might sit on a SharedArrayBuffer. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Returns `iv.ciphertext`, both base64. A fresh IV per call is required. */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

/** Null rather than throwing when the blob is corrupt or the key has rotated. */
export async function decryptSecret(blob: string): Promise<string | null> {
  try {
    const key = await importKey();
    const [ivPart, dataPart] = blob.split('.');
    if (!ivPart || !dataPart) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivPart) },
      key,
      fromBase64(dataPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
