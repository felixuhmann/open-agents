import { seal, unseal } from "../../secrets/crypto.js";

function bytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(buffer.byteLength));
  out.set(buffer);
  return out;
}

export type McpOAuthSecrets = {
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
};

export type SealedMcpOAuthSecrets = {
  encryptedValue: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
};

export function sealMcpOAuthSecrets(secrets: McpOAuthSecrets): SealedMcpOAuthSecrets {
  const sealed = seal(JSON.stringify(secrets));
  return {
    encryptedValue: bytes(sealed.ciphertext),
    iv: bytes(sealed.iv),
    authTag: bytes(sealed.authTag),
  };
}

export function unsealMcpOAuthSecrets(row: {
  encryptedValue: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}): McpOAuthSecrets {
  const plaintext = unseal({
    ciphertext: Buffer.from(row.encryptedValue),
    iv: Buffer.from(row.iv),
    authTag: Buffer.from(row.authTag),
  });
  const value = JSON.parse(plaintext) as unknown;
  if (!value || typeof value !== "object")
    throw new Error("Invalid encrypted MCP OAuth value");
  const record = value as Record<string, unknown>;
  if (typeof record.clientSecret !== "string") {
    throw new Error("Invalid encrypted MCP OAuth value");
  }
  return {
    clientSecret: record.clientSecret,
    ...(typeof record.accessToken === "string"
      ? { accessToken: record.accessToken }
      : {}),
    ...(typeof record.refreshToken === "string"
      ? { refreshToken: record.refreshToken }
      : {}),
    ...(typeof record.tokenType === "string" ? { tokenType: record.tokenType } : {}),
  };
}
