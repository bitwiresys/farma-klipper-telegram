import crypto from 'node:crypto';

function getKeyBytes(encKey: string): Buffer {
  // Accept 32+ chars; normalize to 32 bytes via sha256 to avoid encoding pitfalls.
  return crypto.createHash('sha256').update(encKey, 'utf8').digest();
}

export function encryptApiKey(plain: string, encKey: string): string {
  const key = getKeyBytes(encKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptApiKey(enc: string, encKey: string): string {
  const buf = Buffer.from(enc, 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('Invalid encrypted api key');
  const key = getKeyBytes(encKey);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
