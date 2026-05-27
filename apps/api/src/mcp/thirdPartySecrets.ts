import type { AgentThirdPartyMcp } from "@open-agents/db";
import { seal, unseal } from "../secrets/crypto.js";

function bytes(b: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(b.byteLength));
  out.set(b);
  return out;
}

export type SealedInlineSecret = {
  bearerCipher: Uint8Array<ArrayBuffer>;
  bearerIv: Uint8Array<ArrayBuffer>;
  bearerTag: Uint8Array<ArrayBuffer>;
};

export function sealThirdPartyBearer(bearer: string): SealedInlineSecret {
  const sealed = seal(bearer);
  return {
    bearerCipher: bytes(sealed.ciphertext),
    bearerIv: bytes(sealed.iv),
    bearerTag: bytes(sealed.authTag),
  };
}

export function decryptThirdPartyBearer(row: AgentThirdPartyMcp): string | null {
  if (!row.bearerCipher || !row.bearerIv || !row.bearerTag) return null;
  return unseal({
    ciphertext: Buffer.from(row.bearerCipher),
    iv: Buffer.from(row.bearerIv),
    authTag: Buffer.from(row.bearerTag),
  });
}

export function loadThirdPartyBearerMap(rows: AgentThirdPartyMcp[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const bearer = decryptThirdPartyBearer(row);
    if (bearer) map.set(row.id, bearer);
  }
  return map;
}
