import { createHash, createSign } from "node:crypto";
import { z } from "zod";
import { defineTool, type PlatformHandler } from "../types.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";
const GOOGLE_APPS_PREFIX = "application/vnd.google-apps.";
const MAX_READ_BYTES = 1_000_000;

const ServiceAccountCredentials = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const DriveConfig = z.object({
  sharedDriveId: z.string().trim().min(1),
  rootFolderId: z.string().trim().min(1),
});

const DriveFile = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  parents: z.array(z.string()).optional(),
  driveId: z.string().optional(),
  trashed: z.boolean().optional(),
  size: z.string().optional(),
  modifiedTime: z.string().optional(),
  webViewLink: z.string().optional(),
});

export type DriveFile = z.infer<typeof DriveFile>;
type Fetch = typeof fetch;

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

const tokenCache = new Map<string, CachedToken>();

class DriveBoundaryError extends Error {}

export function validateGoogleDriveServiceAccountJson(rawCredentials: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCredentials);
  } catch {
    throw new Error("Service-account credential must be valid JSON");
  }
  ServiceAccountCredentials.parse(parsed);
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function readGoogleError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as {
      error?: string | { message?: string };
      error_description?: string;
    };
    if (typeof parsed.error === "object" && parsed.error?.message) {
      return parsed.error.message;
    }
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error_description ?? text.slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

async function serviceAccountAccessToken(
  rawCredentials: string,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  let credentialsJson: unknown;
  try {
    credentialsJson = JSON.parse(rawCredentials);
  } catch {
    throw new Error("Google Drive service-account secret is not valid JSON");
  }
  const credentials = ServiceAccountCredentials.parse(credentialsJson);
  const cacheKey = createHash("sha256").update(rawCredentials).digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: credentials.client_email,
    scope: DRIVE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256")
      .update(unsigned)
      .end()
      .sign(credentials.private_key, "base64url");
  } catch {
    throw new Error("Google Drive service-account private key is invalid");
  }

  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Google service-account authentication failed: ${await readGoogleError(response)}`,
    );
  }
  const token = z
    .object({ access_token: z.string(), expires_in: z.number().optional() })
    .parse(await response.json());
  tokenCache.set(cacheKey, {
    accessToken: token.access_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  });
  return token.access_token;
}

function driveQueryLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function fileFields(): string {
  return "id,name,mimeType,parents,driveId,trashed,size,modifiedTime,webViewLink";
}

export class ScopedGoogleDriveClient {
  private rootVerified = false;

  constructor(
    private readonly accessToken: string,
    private readonly config: z.infer<typeof DriveConfig>,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.accessToken}`);
    const response = await this.fetchImpl(url, { ...init, headers });
    if (!response.ok) {
      throw new Error(
        `Google Drive API request failed: ${await readGoogleError(response)}`,
      );
    }
    return response;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const query = new URLSearchParams({
      fields: fileFields(),
      supportsAllDrives: "true",
    });
    const response = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${query.toString()}`,
    );
    return DriveFile.parse(await response.json());
  }

  private async verifyRoot(): Promise<void> {
    if (this.rootVerified) return;
    const root = await this.getFile(this.config.rootFolderId);
    if (root.driveId !== this.config.sharedDriveId) {
      throw new Error("Configured root folder is not in the configured Shared Drive");
    }
    if (root.mimeType !== FOLDER_MIME_TYPE || root.trashed) {
      throw new Error("Configured Google Drive root is not an active folder");
    }
    this.rootVerified = true;
  }

  async assertWithinRoot(fileId: string): Promise<DriveFile> {
    await this.verifyRoot();
    if (fileId === this.config.rootFolderId) return this.getFile(fileId);

    const seen = new Set<string>();
    let current = await this.getFile(fileId);
    const requested = current;
    for (let depth = 0; depth < 100; depth += 1) {
      if (current.driveId !== this.config.sharedDriveId || current.trashed) break;
      const parentId = current.parents?.[0];
      if (!parentId || seen.has(parentId)) break;
      if (parentId === this.config.rootFolderId) return requested;
      seen.add(parentId);
      current = await this.getFile(parentId);
    }
    throw new DriveBoundaryError(
      "Google Drive item is outside the configured AI-accessible folder",
    );
  }

  async listFiles(parentId: string, pageSize: number, pageToken?: string) {
    const parent = await this.assertWithinRoot(parentId);
    if (parent.mimeType !== FOLDER_MIME_TYPE) {
      throw new Error("Google Drive list parent must be a folder");
    }
    const query = new URLSearchParams({
      q: `'${driveQueryLiteral(parentId)}' in parents and trashed = false`,
      corpora: "drive",
      driveId: this.config.sharedDriveId,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      orderBy: "folder,name",
      pageSize: String(pageSize),
      fields: `nextPageToken,files(${fileFields()})`,
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await this.request(`${DRIVE_API}/files?${query.toString()}`);
    return z
      .object({ nextPageToken: z.string().optional(), files: z.array(DriveFile) })
      .parse(await response.json());
  }

  async searchFiles(name: string, limit: number): Promise<DriveFile[]> {
    await this.verifyRoot();
    const query = new URLSearchParams({
      q: `name contains '${driveQueryLiteral(name)}' and trashed = false`,
      corpora: "drive",
      driveId: this.config.sharedDriveId,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      orderBy: "modifiedTime desc",
      pageSize: "100",
      fields: `files(${fileFields()})`,
    });
    const response = await this.request(`${DRIVE_API}/files?${query.toString()}`);
    const candidates = z
      .object({ files: z.array(DriveFile) })
      .parse(await response.json());
    const matches: DriveFile[] = [];
    for (const file of candidates.files) {
      try {
        await this.assertWithinRoot(file.id);
        matches.push(file);
        if (matches.length >= limit) break;
      } catch (error) {
        // Search is scoped to the Shared Drive first, then filtered to the
        // configured folder tree. Items outside it are intentionally hidden.
        if (!(error instanceof DriveBoundaryError)) throw error;
      }
    }
    return matches;
  }

  async readFile(fileId: string, maxChars: number) {
    const file = await this.assertWithinRoot(fileId);
    if (file.mimeType === FOLDER_MIME_TYPE)
      throw new Error("Cannot read a folder as a file");
    if (file.mimeType === SHORTCUT_MIME_TYPE) {
      throw new Error("Google Drive shortcuts are not readable by this scoped tool");
    }

    let url: string;
    if (file.mimeType.startsWith(GOOGLE_APPS_PREFIX)) {
      const exportMime =
        file.mimeType === "application/vnd.google-apps.spreadsheet"
          ? "text/csv"
          : file.mimeType === "application/vnd.google-apps.document" ||
              file.mimeType === "application/vnd.google-apps.presentation"
            ? "text/plain"
            : null;
      if (!exportMime) {
        throw new Error(`Unsupported Google Workspace file type: ${file.mimeType}`);
      }
      const query = new URLSearchParams({ mimeType: exportMime });
      url = `${DRIVE_API}/files/${encodeURIComponent(file.id)}/export?${query.toString()}`;
    } else {
      const query = new URLSearchParams({ alt: "media", supportsAllDrives: "true" });
      url = `${DRIVE_API}/files/${encodeURIComponent(file.id)}?${query.toString()}`;
    }

    const response = await this.request(url, {
      headers: { range: `bytes=0-${MAX_READ_BYTES - 1}` },
    });
    const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, MAX_READ_BYTES);
    const content = bytes.toString("utf8");
    const truncated = content.length > maxChars || bytes.byteLength >= MAX_READ_BYTES;
    return {
      file,
      content: content.slice(0, maxChars),
      truncated,
      bytesRead: bytes.byteLength,
    };
  }

  async createFile(parentId: string, name: string, content: string, mimeType: string) {
    const parent = await this.assertWithinRoot(parentId);
    if (parent.mimeType !== FOLDER_MIME_TYPE) {
      throw new Error("Google Drive create parent must be a folder");
    }
    if (mimeType.startsWith(GOOGLE_APPS_PREFIX)) {
      throw new Error(
        "Create regular files; Google-native file conversion is not supported",
      );
    }
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify({ name, parents: [parentId], mimeType })], {
        type: "application/json",
      }),
    );
    form.append("media", new Blob([content], { type: mimeType }), name);
    const query = new URLSearchParams({
      uploadType: "multipart",
      supportsAllDrives: "true",
      fields: fileFields(),
    });
    const response = await this.request(`${DRIVE_UPLOAD_API}/files?${query.toString()}`, {
      method: "POST",
      body: form,
    });
    return DriveFile.parse(await response.json());
  }

  async createFolder(parentId: string, name: string) {
    const parent = await this.assertWithinRoot(parentId);
    if (parent.mimeType !== FOLDER_MIME_TYPE) {
      throw new Error("Google Drive create parent must be a folder");
    }
    const query = new URLSearchParams({
      supportsAllDrives: "true",
      fields: fileFields(),
    });
    const response = await this.request(`${DRIVE_API}/files?${query.toString()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, parents: [parentId], mimeType: FOLDER_MIME_TYPE }),
    });
    return DriveFile.parse(await response.json());
  }

  async updateFile(fileId: string, content: string, mimeType?: string) {
    const file = await this.assertWithinRoot(fileId);
    if (
      file.mimeType === FOLDER_MIME_TYPE ||
      file.mimeType.startsWith(GOOGLE_APPS_PREFIX)
    ) {
      throw new Error("Only regular, non-Google-native files can be updated");
    }
    const contentType = mimeType ?? file.mimeType;
    if (contentType.startsWith(GOOGLE_APPS_PREFIX)) {
      throw new Error("Google-native MIME types are not supported for updates");
    }
    const query = new URLSearchParams({
      uploadType: "media",
      supportsAllDrives: "true",
      fields: fileFields(),
    });
    const response = await this.request(
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(file.id)}?${query.toString()}`,
      {
        method: "PATCH",
        headers: { "content-type": contentType },
        body: content,
      },
    );
    return DriveFile.parse(await response.json());
  }
}

async function clientFor(
  configJson: Record<string, unknown>,
): Promise<ScopedGoogleDriveClient> {
  const config = DriveConfig.parse(configJson);
  const { getServiceSecret, SERVICE_KEYS } = await import("../../secrets/service.js");
  const credentials = await getServiceSecret(
    SERVICE_KEYS.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
  );
  if (!credentials) {
    throw new Error(
      "Google Drive service-account JSON is not configured in Service secrets",
    );
  }
  return new ScopedGoogleDriveClient(
    await serviceAccountAccessToken(credentials),
    config,
  );
}

const OptionalParent = z.string().trim().min(1).optional();

export const googleDriveHandler: PlatformHandler = {
  key: "google_drive",
  name: "Google Drive folder",
  description:
    "Read and write files beneath one configured folder in a company Shared Drive. Access is authenticated with the deployment's Google service account and enforced at every operation.",
  requiresSecrets: true,
  configSchema: {
    type: "object",
    required: ["sharedDriveId", "rootFolderId"],
    properties: {
      sharedDriveId: {
        type: "string",
        title: "Shared Drive ID",
        description: "The ID of the company Shared Drive containing the AI folder.",
      },
      rootFolderId: {
        type: "string",
        title: "AI-accessible root folder ID",
        description: "The only folder tree this agent may list, search, read, or write.",
      },
    },
  },
  tools: [
    defineTool({
      name: "google_drive_list",
      description:
        "List direct children of the configured AI folder or one of its subfolders. Omit parentId to list the configured root.",
      input: z.object({
        parentId: OptionalParent,
        pageSize: z.number().int().min(1).max(100).default(50),
        pageToken: z.string().optional(),
      }),
      handler: async (input, ctx) => {
        const config = DriveConfig.parse(ctx.configJson);
        const client = await clientFor(ctx.configJson);
        return client.listFiles(
          input.parentId ?? config.rootFolderId,
          input.pageSize,
          input.pageToken,
        );
      },
    }),
    defineTool({
      name: "google_drive_search",
      description:
        "Search file names beneath the configured AI-accessible folder. Results elsewhere in the Shared Drive are filtered out.",
      input: z.object({
        name: z.string().trim().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      handler: async (input, ctx) =>
        (await clientFor(ctx.configJson)).searchFiles(input.name, input.limit),
    }),
    defineTool({
      name: "google_drive_read",
      description:
        "Read a text file or export a Google Doc, Sheet, or Slides file as text. The item must be beneath the configured AI folder.",
      input: z.object({
        fileId: z.string().trim().min(1),
        maxChars: z.number().int().min(1).max(100_000).default(50_000),
      }),
      handler: async (input, ctx) =>
        (await clientFor(ctx.configJson)).readFile(input.fileId, input.maxChars),
    }),
    defineTool({
      name: "google_drive_create_file",
      description:
        "Create a UTF-8 file beneath the configured AI folder. Omit parentId to write into the configured root.",
      input: z.object({
        name: z.string().trim().min(1).max(255),
        content: z.string(),
        mimeType: z.string().trim().min(1).default("text/plain"),
        parentId: OptionalParent,
      }),
      handler: async (input, ctx) => {
        const config = DriveConfig.parse(ctx.configJson);
        return (await clientFor(ctx.configJson)).createFile(
          input.parentId ?? config.rootFolderId,
          input.name,
          input.content,
          input.mimeType,
        );
      },
    }),
    defineTool({
      name: "google_drive_create_folder",
      description:
        "Create a subfolder beneath the configured AI folder. Omit parentId to create it in the configured root.",
      input: z.object({
        name: z.string().trim().min(1).max(255),
        parentId: OptionalParent,
      }),
      handler: async (input, ctx) => {
        const config = DriveConfig.parse(ctx.configJson);
        return (await clientFor(ctx.configJson)).createFolder(
          input.parentId ?? config.rootFolderId,
          input.name,
        );
      },
    }),
    defineTool({
      name: "google_drive_update_file",
      description:
        "Replace the contents of an existing regular file beneath the configured AI folder. Google-native Docs, Sheets, and Slides cannot be updated by this tool.",
      input: z.object({
        fileId: z.string().trim().min(1),
        content: z.string(),
        mimeType: z.string().trim().min(1).optional(),
      }),
      handler: async (input, ctx) =>
        (await clientFor(ctx.configJson)).updateFile(
          input.fileId,
          input.content,
          input.mimeType,
        ),
    }),
  ],
};
