import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentMountPath,
  prepareAttachments,
  toSessionResources,
  type AttachmentRow,
} from "./attachmentResources.js";

/**
 * `backendFileId` records which logical file a row is, not whether its bytes
 * are present in the sandbox this run will use. Skipping rows that already
 * have one loses the user's attachments on a retry, and loses them entirely
 * when a provider switch puts the run in a brand-new workspace.
 */

function row(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: "att_1",
    filename: "quarterly report.pdf",
    contentType: "application/pdf; charset=binary",
    bytes: new Uint8Array([1, 2, 3]),
    backendFileId: null,
    mountPath: null,
    ...overrides,
  };
}

function fakeDeps() {
  const uploads: string[] = [];
  const persisted: { id: string; fileId: string; mountPath: string }[] = [];
  let next = 0;
  return {
    uploads,
    persisted,
    deps: {
      uploadFile: (input: { filename: string }) => {
        uploads.push(input.filename);
        next += 1;
        return Promise.resolve({ id: `file_${next}` });
      },
      persist: (id: string, fileId: string, mountPath: string) => {
        persisted.push({ id, fileId, mountPath });
        return Promise.resolve();
      },
    },
  };
}

void test("a new attachment is assigned an id, recorded, and mounted", async () => {
  const fake = fakeDeps();

  const prepared = await prepareAttachments([row()], fake.deps);

  assert.deepEqual(fake.uploads, ["quarterly report.pdf"]);
  assert.deepEqual(fake.persisted, [
    { id: "att_1", fileId: "file_1", mountPath: "/workspace/inbox/quarterly_report.pdf" },
  ]);
  assert.equal(prepared[0]?.id, "file_1");
  assert.equal(prepared[0]?.mime, "application/pdf");
  assert.deepEqual(prepared[0]?.bytes, new Uint8Array([1, 2, 3]));
});

void test("a retry after the id was already assigned still mounts the bytes", async () => {
  const fake = fakeDeps();

  const prepared = await prepareAttachments(
    [
      row({
        backendFileId: "file_from_first_attempt",
        mountPath: "/workspace/inbox/quarterly_report.pdf",
      }),
    ],
    fake.deps,
  );

  // No re-upload, no rewrite of history — but the resource is still built.
  assert.deepEqual(fake.uploads, []);
  assert.deepEqual(fake.persisted, []);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]?.id, "file_from_first_attempt");
  assert.deepEqual(prepared[0]?.bytes, new Uint8Array([1, 2, 3]));
});

void test("a run in a fresh workspace after a provider switch rematerializes everything", async () => {
  const fake = fakeDeps();

  // Every row already carries an id from the run on the old provider.
  const prepared = await prepareAttachments(
    [
      row({ id: "att_1", backendFileId: "file_a", mountPath: "/workspace/inbox/a.pdf" }),
      row({
        id: "att_2",
        filename: "b.csv",
        backendFileId: "file_b",
        mountPath: "/workspace/inbox/b.csv",
      }),
    ],
    fake.deps,
  );

  const resources = toSessionResources(prepared);
  assert.deepEqual(
    resources.map((r) => r.mountPath),
    ["/workspace/inbox/a.pdf", "/workspace/inbox/b.csv"],
  );
  assert.equal(
    resources.every((r) => r.bytes !== undefined),
    true,
    "the new sandbox needs the bytes, not just the ids",
  );
});

void test("a partly-uploaded message finishes the rest without redoing the first", async () => {
  const fake = fakeDeps();

  await prepareAttachments(
    [
      row({ id: "att_1", backendFileId: "file_a", mountPath: "/workspace/inbox/a.pdf" }),
      row({ id: "att_2", filename: "b.csv" }),
    ],
    fake.deps,
  );

  assert.deepEqual(fake.uploads, ["b.csv"]);
  assert.deepEqual(
    fake.persisted.map((p) => p.id),
    ["att_2"],
  );
});

void test("the mount path is stable: recorded once, reused forever", () => {
  assert.equal(
    attachmentMountPath({ filename: "a b/c.txt", mountPath: null }),
    "/workspace/inbox/a_b_c.txt",
  );
  assert.equal(
    attachmentMountPath({
      filename: "renamed.txt",
      mountPath: "/workspace/inbox/orig.txt",
    }),
    "/workspace/inbox/orig.txt",
  );
});

void test("a message with no attachments does no work", async () => {
  const fake = fakeDeps();

  assert.deepEqual(await prepareAttachments([], fake.deps), []);
  assert.deepEqual(fake.uploads, []);
});
