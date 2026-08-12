import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

const { MediaService } = await import("../dist-electron/media-service.cjs");
const { appendUniqueMediaFiles, processMediaQueueSequentially } = await import("../dist-electron/media-queue.cjs");

const local = (filePath, bytes = 10) => ({ filePath, fileName: basename(filePath), bytes });
const record = (filePath, stage, patch = {}) => ({
  id: `${stage}-${basename(filePath)}`, fileName: basename(filePath), filePath, bytes: 10,
  sha256: "abc", stage, progress: 100, visibility: "public", mediaId: "media-1",
  objectUploaded: stage !== "failed", publicId: "public-1", shareUrl: "https://kcxlabs.org/c/public-1",
  duplicate: false, error: stage === "failed" ? "upload failed" : null, moveError: null, movedTo: null,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), ...patch,
});

test("multi-file description returns every supported selected video", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-media-select-"));
  const first = join(root, "one.mp4"); const second = join(root, "two.webm"); const ignored = join(root, "notes.txt");
  await Promise.all([writeFile(first, "one"), writeFile(second, "two"), writeFile(ignored, "no")]);
  const service = new MediaService(join(root, "user-data"));
  const files = await service.describeFiles([first, second, ignored]);
  assert.deepEqual(files.map((file) => file.fileName), ["one.mp4", "two.webm"]);
});

test("queue de-duplicates the same local path case-insensitively", () => {
  const queue = appendUniqueMediaFiles([], [local("D:\\Clips\\One.mp4"), local("d:/clips/one.mp4"), local("D:\\Clips\\Two.mp4")]);
  assert.deepEqual(queue.map((item) => item.fileName), ["One.mp4", "Two.mp4"]);
});

test("Upload All is sequential and one failure does not stop later items", async () => {
  const items = appendUniqueMediaFiles([], [local("one.mp4"), local("two.mp4"), local("three.mp4")]);
  const calls = []; let active = 0; let maxActive = 0;
  const states = new Map(items.map((item) => [item.filePath, item]));
  await processMediaQueueSequentially(items, async (filePath) => {
    calls.push(filePath); active += 1; maxActive = Math.max(maxActive, active);
    await Promise.resolve(); active -= 1;
    return filePath === "two.mp4" ? record(filePath, "failed") : record(filePath, "moved", { movedTo: `sent/${filePath}` });
  }, (filePath, patch) => states.set(filePath, { ...states.get(filePath), ...patch }));
  assert.deepEqual(calls, ["one.mp4", "two.mp4", "three.mp4"]);
  assert.equal(maxActive, 1);
  assert.equal(states.get("two.mp4").status, "failed");
  assert.equal(states.get("three.mp4").status, "complete");
});

test("failed upload leaves source untouched while finalized and duplicate records are movable", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-media-boundary-")); const sent = join(root, "sent");
  const failedSource = join(root, "failed.mp4"); await writeFile(failedSource, "failed");
  const service = new MediaService(join(root, "user-data"));
  await assert.rejects(() => service.movePublishedFile(record(failedSource, "failed"), () => {}, sent), /only move after/);
  assert.equal((await stat(failedSource)).isFile(), true);
  for (const [name, duplicate] of [["finalized.mp4", false], ["duplicate.mp4", true]]) {
    const source = join(root, name); await writeFile(source, name);
    const moved = await service.movePublishedFile(record(source, "finalized", { duplicate, objectUploaded: !duplicate }), () => {}, sent);
    assert.equal(moved.stage, "moved"); assert.equal(await readFile(moved.movedTo, "utf8"), name);
  }
});

test("move creates destination and resolves collisions without overwriting", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-media-collision-")); const source = join(root, "clip.mp4"); const sent = join(root, "new-sent");
  await writeFile(source, "new"); await mkdir(sent); await writeFile(join(sent, "clip.mp4"), "existing");
  const service = new MediaService(join(root, "user-data"));
  const moved = await service.movePublishedFile(record(source, "finalized"), () => {}, sent);
  assert.equal(basename(moved.movedTo), "clip (1).mp4");
  assert.equal(await readFile(join(sent, "clip.mp4"), "utf8"), "existing");
  assert.equal(await readFile(moved.movedTo, "utf8"), "new");
});

test("move failure preserves published state and source file", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-media-move-fail-")); const source = join(root, "clip.mp4");
  await writeFile(source, "published");
  const service = new MediaService(join(root, "user-data"));
  const result = await service.movePublishedFile(record(source, "finalized"), () => {}, join(source, "impossible-child"));
  assert.equal(result.stage, "finalized"); assert.ok(result.moveError); assert.equal((await stat(source)).isFile(), true);
});
