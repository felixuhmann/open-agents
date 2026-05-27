import { prisma } from "../db.js";
import { seal, unseal } from "./crypto.js";

/**
 * Copy a Node `Buffer` into a fresh `Uint8Array` whose backing store is a
 * concrete `ArrayBuffer` (not `SharedArrayBuffer`). Required because
 * Prisma's generated `Bytes` field type rejects the broader
 * `ArrayBufferLike` Buffer is parameterized over.
 */
function bytes(b: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(b.byteLength));
  out.set(b);
  return out;
}

/**
 * Service-credential keys consumed by infrastructure init. `tool` scoped
 * secrets are stored against an AgentToolBinding instead.
 */
export const SERVICE_KEYS = {
  ANTHROPIC_API_KEY: "anthropic_api_key",
  ANTHROPIC_VAULT_ID: "anthropic_vault_id",
  DAYTONA_API_KEY: "daytona_api_key",
  MAILGUN_API_KEY: "mailgun_api_key",
  MAILGUN_DOMAIN: "mailgun_domain",
  MAILGUN_SIGNING_KEY: "mailgun_signing_key",
  /** Legacy encrypted location for default outbound `From:` before it moved to AppSetting. */
  INBOUND_FROM: "inbound_from",
} as const;

export type ServiceKey = (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS];

const cache = new Map<string, string>();

/**
 * Read a deployment-wide service credential. Cached per-process; call
 * `invalidateServiceSecret` after writes so the next read sees the new value.
 */
export async function getServiceSecret(key: ServiceKey): Promise<string | null> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const row = await prisma.secret.findFirst({
    where: { scope: "service", key, toolBindingId: null },
  });
  if (!row) return null;
  const plaintext = unseal({
    ciphertext: Buffer.from(row.encryptedValue),
    iv: Buffer.from(row.iv),
    authTag: Buffer.from(row.authTag),
  });
  cache.set(key, plaintext);
  return plaintext;
}

export async function setServiceSecret(key: ServiceKey, value: string): Promise<void> {
  const sealed = seal(value);
  const existing = await prisma.secret.findFirst({
    where: { scope: "service", key, toolBindingId: null },
  });
  if (existing) {
    await prisma.secret.update({
      where: { id: existing.id },
      data: {
        encryptedValue: bytes(sealed.ciphertext),
        iv: bytes(sealed.iv),
        authTag: bytes(sealed.authTag),
      },
    });
  } else {
    await prisma.secret.create({
      data: {
        scope: "service",
        key,
        encryptedValue: bytes(sealed.ciphertext),
        iv: bytes(sealed.iv),
        authTag: bytes(sealed.authTag),
      },
    });
  }
  cache.set(key, value);
}

export async function deleteServiceSecret(key: ServiceKey): Promise<void> {
  await prisma.secret.deleteMany({
    where: { scope: "service", key, toolBindingId: null },
  });
  cache.delete(key);
}

export function invalidateServiceSecret(key?: ServiceKey): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Read all secret values bound to a single AgentToolBinding as a flat map.
 * Returns `{}` when no secrets are configured.
 */
export async function getToolSecrets(bindingId: string): Promise<Record<string, string>> {
  const rows = await prisma.secret.findMany({
    where: { scope: "tool", toolBindingId: bindingId },
  });
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.key] = unseal({
      ciphertext: Buffer.from(row.encryptedValue),
      iv: Buffer.from(row.iv),
      authTag: Buffer.from(row.authTag),
    });
  }
  return out;
}

export async function setToolSecret(
  bindingId: string,
  key: string,
  value: string,
): Promise<void> {
  const sealed = seal(value);
  const existing = await prisma.secret.findFirst({
    where: { scope: "tool", key, toolBindingId: bindingId },
  });
  if (existing) {
    await prisma.secret.update({
      where: { id: existing.id },
      data: {
        encryptedValue: bytes(sealed.ciphertext),
        iv: bytes(sealed.iv),
        authTag: bytes(sealed.authTag),
      },
    });
  } else {
    await prisma.secret.create({
      data: {
        scope: "tool",
        key,
        encryptedValue: bytes(sealed.ciphertext),
        iv: bytes(sealed.iv),
        authTag: bytes(sealed.authTag),
        toolBindingId: bindingId,
      },
    });
  }
}

export async function deleteToolSecrets(bindingId: string): Promise<void> {
  await prisma.secret.deleteMany({
    where: { scope: "tool", toolBindingId: bindingId },
  });
}

/** Whether the deployment has any service-credential rows yet. */
export async function isServiceSetupComplete(): Promise<boolean> {
  const required: ServiceKey[] = [SERVICE_KEYS.ANTHROPIC_API_KEY];
  for (const k of required) {
    const v = await getServiceSecret(k);
    if (!v) return false;
  }
  return true;
}
