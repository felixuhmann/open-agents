import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  return Buffer.from(config.SECRET_ENCRYPTION_KEY, "hex");
}

export type Sealed = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function unseal(sealed: Sealed): string {
  const decipher = createDecipheriv(ALGO, key(), sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  const plaintext = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
