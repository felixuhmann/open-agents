import { getAnthropicClient, resetAgentBackend } from "../agent-backend/instance.js";
import { config } from "../config.js";
import { log } from "../log.js";
import {
  getServiceSecret,
  invalidateServiceSecret,
  SERVICE_KEYS,
  setServiceSecret,
} from "../secrets/service.js";
import { buildMcpServerUrl } from "./provisioning.js";

/**
 * Read the deployment vault id from the encrypted Secret store, or create
 * one on Anthropic's side and persist the returned id. Idempotent — safe
 * to call from any code path that needs `vault_ids[]` to exist.
 *
 * The vault is the per-deployment container Anthropic looks credentials up
 * in when starting a session. We keep exactly one and store its id under
 * the internal `anthropic_vault_id` Secret key.
 *
 * On creation we also reset the Anthropic backend singleton so the next
 * `createSession` call sees the new `vault_ids` value.
 */
export async function ensureVaultId(): Promise<string> {
  const existing = await getServiceSecret(SERVICE_KEYS.ANTHROPIC_VAULT_ID);
  if (existing) return existing;

  const client = await getAnthropicClient();
  const created = await client.beta.vaults.create({
    display_name: "open-agents backend",
    metadata: { source: "open-agents-auto-provision" },
  });
  const id = created.id;

  await setServiceSecret(SERVICE_KEYS.ANTHROPIC_VAULT_ID, id);
  invalidateServiceSecret(SERVICE_KEYS.ANTHROPIC_VAULT_ID);
  resetAgentBackend();

  log.info("anthropic: vault auto-created", { vaultId: id });
  return id;
}

export type EnsuredCredential = {
  /** Anthropic credential id (`vcrd_…`). */
  id: string;
  /** URL the credential is bound to (returned for caller to persist). */
  url: string;
};

export type EnsureCredentialArgs = {
  slug: string;
  /** Existing `Agent.anthropicMcpCredentialId`, if any. */
  existingId: string | null;
  /** Existing `Agent.anthropicMcpCredentialUrl`, if any. */
  existingUrl: string | null;
};

/**
 * Make sure Anthropic's vault has a `static_bearer` credential mapping the
 * agent's MCP URL to our `MCP_AUTH_TOKEN`. Returns the credential id +
 * URL so the publish flow can persist them onto the `Agent` row.
 *
 * The contract is "republish == fully reconcile":
 *
 * - No existing credential ⇒ create a fresh one.
 * - Existing credential whose URL still matches ⇒ PATCH the bearer so a
 *   rotated `MCP_AUTH_TOKEN` lands without manual intervention.
 * - Existing credential whose URL drifted (e.g. `PUBLIC_BASE_URL` was
 *   moved) ⇒ Anthropic rejects URL changes on update, so we archive the
 *   stale row best-effort and create a fresh one bound to the new URL.
 * - Existing id but Anthropic 404s ⇒ treat as missing and create. This is
 *   the recovery path when an admin nuked the vault out from under us.
 */
export async function ensureMcpCredential(
  args: EnsureCredentialArgs,
): Promise<EnsuredCredential> {
  const vaultId = await ensureVaultId();
  const desiredUrl = buildMcpServerUrl(args.slug);
  const client = await getAnthropicClient();

  if (args.existingId && args.existingUrl === desiredUrl) {
    try {
      await client.beta.vaults.credentials.update(args.existingId, {
        vault_id: vaultId,
        auth: { type: "static_bearer", token: config.MCP_AUTH_TOKEN },
      });
      log.info("anthropic: mcp credential refreshed", {
        vaultId,
        credentialId: args.existingId,
        url: desiredUrl,
      });
      return { id: args.existingId, url: desiredUrl };
    } catch (err) {
      // Fall through to create — vault was likely wiped server-side.
      log.warn("anthropic: mcp credential refresh failed, recreating", {
        vaultId,
        credentialId: args.existingId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // URL drifted (or no row yet). Archive the stale credential best-effort
  // before creating a fresh one so the vault doesn't accumulate dead rows.
  if (args.existingId) {
    try {
      await client.beta.vaults.credentials.archive(args.existingId, {
        vault_id: vaultId,
      });
    } catch (err) {
      log.warn("anthropic: mcp credential archive failed", {
        vaultId,
        credentialId: args.existingId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const created = await client.beta.vaults.credentials.create(vaultId, {
    display_name: `open-agents:${args.slug}`,
    metadata: { source: "open-agents-auto-provision", slug: args.slug },
    auth: {
      type: "static_bearer",
      token: config.MCP_AUTH_TOKEN,
      mcp_server_url: desiredUrl,
    },
  });

  log.info("anthropic: mcp credential created", {
    vaultId,
    credentialId: created.id,
    url: desiredUrl,
  });

  return { id: created.id, url: desiredUrl };
}
