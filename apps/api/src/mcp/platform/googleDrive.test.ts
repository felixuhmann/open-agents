import assert from "node:assert/strict";
import test from "node:test";
import { ScopedGoogleDriveClient } from "./googleDrive.js";

const FOLDER = "application/vnd.google-apps.folder";

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function file(
  id: string,
  name: string,
  mimeType: string,
  parents?: string[],
  driveId = "drive-1",
) {
  return { id, name, mimeType, parents, driveId, trashed: false };
}

function fetchUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

void test("lists only from a folder under the configured root", async () => {
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = fetchUrl(input);
    requests.push(url);
    if (url.pathname.endsWith("/files/root")) {
      return Promise.resolve(json(file("root", "AI", FOLDER)));
    }
    if (url.pathname.endsWith("/files/child")) {
      return Promise.resolve(json(file("child", "Child", FOLDER, ["root"])));
    }
    if (url.pathname.endsWith("/files")) {
      return Promise.resolve(
        json({ files: [file("note", "note.txt", "text/plain", ["child"])] }),
      );
    }
    return Promise.resolve(json({ error: { message: "not found" } }, 404));
  };
  const client = new ScopedGoogleDriveClient(
    "token",
    { sharedDriveId: "drive-1", rootFolderId: "root" },
    fetchImpl,
  );

  const result = await client.listFiles("child", 25);

  assert.equal(result.files[0]?.id, "note");
  const listRequest = requests.find((url) => url.pathname.endsWith("/files"));
  assert.equal(listRequest?.searchParams.get("driveId"), "drive-1");
  assert.match(listRequest?.searchParams.get("q") ?? "", /'child' in parents/);
});

void test("rejects writes outside the configured folder tree", async () => {
  let uploaded = false;
  const fetchImpl: typeof fetch = (input) => {
    const url = fetchUrl(input);
    if (url.hostname === "www.googleapis.com" && url.pathname.includes("/upload/")) {
      uploaded = true;
    }
    if (url.pathname.endsWith("/files/root")) {
      return Promise.resolve(json(file("root", "AI", FOLDER)));
    }
    if (url.pathname.endsWith("/files/outside")) {
      return Promise.resolve(
        json(file("outside", "outside.txt", "text/plain", ["elsewhere"])),
      );
    }
    if (url.pathname.endsWith("/files/elsewhere")) {
      return Promise.resolve(json(file("elsewhere", "Elsewhere", FOLDER)));
    }
    return Promise.resolve(json({ error: { message: "not found" } }, 404));
  };
  const client = new ScopedGoogleDriveClient(
    "token",
    { sharedDriveId: "drive-1", rootFolderId: "root" },
    fetchImpl,
  );

  await assert.rejects(
    client.updateFile("outside", "changed"),
    /outside the configured AI-accessible folder/,
  );
  assert.equal(uploaded, false);
});

void test("search hides matching files elsewhere in the Shared Drive", async () => {
  const fetchImpl: typeof fetch = (input) => {
    const url = fetchUrl(input);
    if (url.pathname.endsWith("/files/root")) {
      return Promise.resolve(json(file("root", "AI", FOLDER)));
    }
    if (url.pathname.endsWith("/files/inside")) {
      return Promise.resolve(json(file("inside", "plan.txt", "text/plain", ["root"])));
    }
    if (url.pathname.endsWith("/files/outside")) {
      return Promise.resolve(
        json(file("outside", "plan-old.txt", "text/plain", ["elsewhere"])),
      );
    }
    if (url.pathname.endsWith("/files/elsewhere")) {
      return Promise.resolve(json(file("elsewhere", "Elsewhere", FOLDER)));
    }
    if (url.pathname.endsWith("/files")) {
      return Promise.resolve(
        json({
          files: [
            file("inside", "plan.txt", "text/plain", ["root"]),
            file("outside", "plan-old.txt", "text/plain", ["elsewhere"]),
          ],
        }),
      );
    }
    return Promise.resolve(json({ error: { message: "not found" } }, 404));
  };
  const client = new ScopedGoogleDriveClient(
    "token",
    { sharedDriveId: "drive-1", rootFolderId: "root" },
    fetchImpl,
  );

  const matches = await client.searchFiles("plan", 10);

  assert.deepEqual(
    matches.map((match) => match.id),
    ["inside"],
  );
});

void test("search surfaces Drive API failures instead of looking like no results", async () => {
  const fetchImpl: typeof fetch = (input) => {
    const url = fetchUrl(input);
    if (url.pathname.endsWith("/files/root")) {
      return Promise.resolve(json(file("root", "AI", FOLDER)));
    }
    if (url.pathname.endsWith("/files/denied")) {
      return Promise.resolve(json({ error: { message: "permission denied" } }, 403));
    }
    if (url.pathname.endsWith("/files")) {
      return Promise.resolve(
        json({ files: [file("denied", "plan.txt", "text/plain", ["root"])] }),
      );
    }
    return Promise.resolve(json({ error: { message: "not found" } }, 404));
  };
  const client = new ScopedGoogleDriveClient(
    "token",
    { sharedDriveId: "drive-1", rootFolderId: "root" },
    fetchImpl,
  );

  await assert.rejects(client.searchFiles("plan", 10), /permission denied/);
});

void test("rejects unsupported binary files instead of decoding them as UTF-8", async () => {
  const fetchImpl: typeof fetch = (input) => {
    const url = fetchUrl(input);
    if (url.pathname.endsWith("/files/root")) {
      return Promise.resolve(json(file("root", "AI", FOLDER)));
    }
    if (url.pathname.endsWith("/files/report")) {
      return Promise.resolve(
        json(file("report", "report.pdf", "application/pdf", ["root"])),
      );
    }
    return Promise.resolve(json({ error: { message: "not found" } }, 404));
  };
  const client = new ScopedGoogleDriveClient(
    "token",
    { sharedDriveId: "drive-1", rootFolderId: "root" },
    fetchImpl,
  );

  await assert.rejects(
    client.readFile("report", 10_000),
    /Unsupported binary file type for text extraction: application\/pdf/,
  );
});
