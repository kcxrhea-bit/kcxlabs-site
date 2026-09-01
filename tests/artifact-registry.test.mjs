import assert from "node:assert/strict";
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { recoverStagedArtifact, registerArtifact, stageArtifact, verifyArtifact } = await import(new URL("../dist-electron/artifact-registry.cjs", import.meta.url));
const { artifactRemoteKey, normalizeArtifactPlatform, publishArtifact, reconcilePublishedArtifact, resolveArtifactPlatform } = await import(new URL("../dist-electron/artifact-publisher.cjs", import.meta.url));
const { loadReleaseStorageConfig } = await import(new URL("../dist-electron/r2-release-provider.cjs", import.meta.url));
const { releaseStorageFingerprint } = await import(new URL("../dist-electron/release-fingerprint.cjs", import.meta.url));
const { getArtifactPublishReadiness } = await import(new URL("../dist-electron/release-certification.cjs", import.meta.url));
const { PlatformService } = await import(new URL("../dist-electron/platform-service.cjs", import.meta.url));

test("uses one canonical release fingerprint for certification and readiness", () => {
  const input = { endpoint: "HTTPS://R2.EXAMPLE/", bucket: "releases", region: "AUTO", publicBaseUrl: "https://downloads.example/", accessKeyId: "id", secretAccessKey: "secret" };
  const fingerprint = releaseStorageFingerprint(input);
  const artifact = { validationStatus: "STAGED", publicationStatus: "NOT_PUBLISHED" };
  assert.deepEqual(getArtifactPublishReadiness(artifact, { configured: true, providerCertified: true, configurationFingerprint: fingerprint }, fingerprint), { ready: true, reason: "READY" });
  assert.equal(getArtifactPublishReadiness(artifact, { configured: true, providerCertified: true, configurationFingerprint: "wrong" }, fingerprint).reason, "CERTIFICATION_STALE");
  assert.equal(getArtifactPublishReadiness(artifact, { configured: true, providerCertified: false }, fingerprint).reason, "NOT_CERTIFIED");
});

test("save, test, probe, reload keeps certification current and readiness enabled", () => {
  const saved = { endpoint: "HTTPS://R2.EXAMPLE/", bucket: "releases", region: "AUTO", publicBaseUrl: "https://downloads.example/", accessKeyId: "id", secretAccessKey: "secret" };
  const currentAfterSave = releaseStorageFingerprint(saved);
  const afterConnection = { configurationFingerprint: currentAfterSave, providerCertified: false, lastConnectionTestSucceeded: true };
  const afterProbe = { ...afterConnection, configurationFingerprint: currentAfterSave, providerCertified: true, lastProbeSucceeded: true };
  const reloaded = { ...saved, certification: afterProbe };
  const currentAfterReload = releaseStorageFingerprint(reloaded);
  assert.equal(currentAfterReload, currentAfterSave);
  assert.equal(reloaded.certification.providerCertified, true);
  assert.deepEqual(getArtifactPublishReadiness({ validationStatus: "STAGED", publicationStatus: "NOT_PUBLISHED" }, { configured: true, providerCertified: reloaded.certification.providerCertified, configurationFingerprint: reloaded.certification.configurationFingerprint }, currentAfterReload), { ready: true, reason: "READY" });
  const changed = { ...reloaded, region: "us-east-1" };
  const currentAfterChange = releaseStorageFingerprint(changed);
  assert.notEqual(currentAfterChange, currentAfterReload);
  assert.equal(getArtifactPublishReadiness({ validationStatus: "STAGED", publicationStatus: "NOT_PUBLISHED" }, { configured: true, providerCertified: true, configurationFingerprint: reloaded.certification.configurationFingerprint }, currentAfterChange).reason, "CERTIFICATION_STALE");
});

test("registers, verifies, and stages a generic artifact without publishing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-artifact-"));
  const source = join(root, "app.apk");
  await writeFile(source, "validated payload");
  const record = await registerArtifact({ id: "ignored", projectId: "p", projectName: "P", target: "apk", architecture: "x64", filename: "app.apk", sourcePath: source, builtAt: new Date().toISOString(), validationEvidence: [], publicationStatus: "NOT_PUBLISHED" });
  assert.equal(record.validationStatus, "VALIDATED");
  const staged = await stageArtifact(record, root);
  assert.equal(staged.validationStatus, "STAGED");
  assert.equal(staged.publicationStatus, "NOT_PUBLISHED");
  assert.equal((await stat(staged.stagedPath)).size, record.bytes);
});

test("rejects a changed artifact during integrity verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-artifact-"));
  const source = join(root, "app.exe");
  await writeFile(source, "original");
  const record = await registerArtifact({ id: "ignored", projectId: "p", projectName: "P", target: "executable", architecture: "x64", filename: "app.exe", sourcePath: source, builtAt: new Date().toISOString(), validationEvidence: [], publicationStatus: "NOT_PUBLISHED" });
  await writeFile(source, "changed");
  await assert.rejects(() => verifyArtifact(record), /size changed|hash mismatch/);
});

test("verification preserves staged and published lifecycle states", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-verify-lifecycle-"));
  const source = join(root, "app.exe"); await writeFile(source, "verified payload");
  const base = await registerArtifact({ projectId: "p", projectName: "P", target: "executable", architecture: "x64", filename: "app.exe", sourcePath: source, builtAt: new Date().toISOString(), validationEvidence: [], publicationStatus: "NOT_PUBLISHED" });
  const staged = await stageArtifact(base, root);
  assert.equal((await verifyArtifact(staged)).validationStatus, "STAGED");
  assert.equal((await verifyArtifact({ ...staged, validationStatus: "VALIDATED" })).validationStatus, "VALIDATED");
  assert.equal((await verifyArtifact({ ...staged, validationStatus: "PUBLISHED", publicationStatus: "PUBLISHED" })).validationStatus, "PUBLISHED");
  assert.equal((await verifyArtifact({ ...staged, validationStatus: "DEPLOYED", publicationStatus: "DEPLOYED" })).validationStatus, "DEPLOYED");
});

test("verification failure does not advance lifecycle or readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-verify-failure-"));
  const source = join(root, "app.zip"); await writeFile(source, "original");
  const base = await registerArtifact({ projectId: "p", projectName: "P", target: "zip", architecture: "any", filename: "app.zip", sourcePath: source, builtAt: new Date().toISOString(), validationEvidence: [], publicationStatus: "NOT_PUBLISHED" });
  const staged = await stageArtifact(base, root); await writeFile(staged.sourcePath, "changed");
  await assert.rejects(() => verifyArtifact(staged), /size changed|hash mismatch/);
  assert.equal(staged.validationStatus, "STAGED");
  assert.deepEqual(getArtifactPublishReadiness(staged, { configured: true, providerCertified: true, configurationFingerprint: "same" }, "same"), { ready: true, reason: "READY" });
});

test("recovers old-bug VALIDATED records only from a matching canonical staged file", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-recover-staged-"));
  const source = join(root, "source.exe"); await writeFile(source, "staged payload");
  const validated = await registerArtifact({ projectId: "p", projectName: "P", target: "installer", architecture: "x64", filename: "app.exe", sourcePath: source, builtAt: new Date().toISOString(), validationEvidence: [], publicationStatus: "NOT_PUBLISHED" });
  const staged = await stageArtifact(validated, root);
  const damaged = { ...staged, validationStatus: "VALIDATED" };
  const recovered = await recoverStagedArtifact(damaged, root);
  assert.equal(recovered.validationStatus, "STAGED");
  assert.equal(recovered.publicationStatus, "NOT_PUBLISHED");
  const certified = "certified-fingerprint";
  assert.deepEqual(getArtifactPublishReadiness(recovered, { configured: true, providerCertified: true, configurationFingerprint: certified }, certified), { ready: true, reason: "READY" });
  await assert.rejects(() => recoverStagedArtifact({ ...damaged, stagedPath: join(root, "other.exe") }, root), /canonical artifact location/);
  await writeFile(staged.stagedPath, "tampered");
  await assert.rejects(() => recoverStagedArtifact(damaged, root), /size changed|hash mismatch/);
});

test("publishes only staged artifacts and preserves truthful remote metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-publisher-"));
  const source = join(root, "app.zip"); await writeFile(source, "payload");
  const record = await registerArtifact({ projectId: "p", projectName: "P", target: "zip", platform: "windows", architecture: "any", filename: "app.zip", sourcePath: source, builtAt: new Date().toISOString(), validationEvidence: [], publicationStatus: "NOT_PUBLISHED" });
  const staged = await stageArtifact(record, root);
  const published = await publishArtifact(staged, { upload: async ({ key }) => ({ objectKey: key, publicUrl: `https://cdn.example/${key}`, size: staged.bytes, sha256: staged.sha256, etag: "etag" }) });
  assert.equal(published.publicationStatus, "PUBLISHED"); assert.match(published.publicationDestination, /^https:/); assert.equal(published.remoteObjectKey, artifactRemoteKey(staged));
});

test("does not publish without a configured backend", async () => {
  await assert.rejects(() => publishArtifact({ validationStatus: "STAGED" }, undefined), /No artifact publishing backend/);
});

test("release provider configuration is optional and never exposes partial credentials", () => {
  assert.equal(loadReleaseStorageConfig({ RELEASE_R2_BUCKET: "bucket" }), null);
  const config = loadReleaseStorageConfig({ RELEASE_R2_ENDPOINT: "https://r2.example", RELEASE_R2_BUCKET: "releases", RELEASE_R2_ACCESS_KEY_ID: "id", RELEASE_R2_SECRET_ACCESS_KEY: "secret", RELEASE_R2_PUBLIC_BASE_URL: "https://downloads.example/" });
  assert.deepEqual(config, { endpoint: "https://r2.example", bucket: "releases", region: "auto", accessKeyId: "id", secretAccessKey: "secret", publicBaseUrl: "https://downloads.example" });
});

test("normalizes publication platforms and refuses unresolved remote keys", () => {
  const base = { projectId: "p", version: "1.0.0", architecture: "x64", target: "installer", filename: "setup.exe" };
  assert.equal(normalizeArtifactPlatform("Win32"), "windows");
  assert.equal(resolveArtifactPlatform({ ...base, platform: undefined }), "windows");
  assert.match(artifactRemoteKey({ ...base, platform: undefined }), /\/windows\/x64\/installer\/setup\.exe$/);
  assert.match(artifactRemoteKey({ ...base, platform: "Android", filename: "app.bin" }), /\/android\/x64\/installer\/app\.bin$/);
  assert.match(artifactRemoteKey({ ...base, platform: "linux", filename: "app.AppImage" }), /\/linux\/x64\/installer\/app\.AppImage$/);
  assert.throws(() => artifactRemoteKey({ ...base, filename: "release.zip", platform: undefined }), /platform is unresolved/);
  assert.doesNotMatch(artifactRemoteKey({ ...base, platform: undefined }), /\/unknown\//);
});

test("records successful artifact publication activity without credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-activity-"));
  const service = new PlatformService(root, root);
  await service.record("Artifact published", "KCx Labs 1.0.0: installer windows x64 setup.exe -> https://downloads.example/releases/p/1.0.0/windows/x64/installer/setup.exe");
  const entries = await service.getActivity();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "Artifact published");
  assert.doesNotMatch(entries[0].detail, /access|secret|credential|fingerprint/i);
});

test("reconciles a published legacy key only after provider and public verification", async () => {
  const record = { projectId: "p", projectName: "P", version: "1.0.0", target: "installer", platform: "windows", architecture: "x64", filename: "setup.exe", bytes: 7, sha256: "ABC", validationStatus: "STAGED", publicationStatus: "PUBLISHED", remoteObjectKey: "releases/p/1.0.0/unknown/x64/installer/setup.exe", publicationDestination: "https://downloads.example/releases/p/1.0.0/unknown/x64/installer/setup.exe" };
  let copied = false;
  const provider = { copyObject: async (sourceKey, destinationKey, expected) => { assert.equal(sourceKey, record.remoteObjectKey); assert.equal(expected.size, 7); assert.equal(expected.sha256, "ABC"); copied = true; return { objectKey: destinationKey, publicUrl: `https://downloads.example/${destinationKey}`, size: 7, sha256: "ABC", etag: "etag" }; } };
  const fetchOk = async () => new Response("1234567", { status: 200 });
  const reconciled = await reconcilePublishedArtifact(record, provider, "https://downloads.example/", fetchOk);
  assert.equal(copied, true);
  assert.equal(reconciled.publicationStatus, "PUBLISHED");
  assert.equal(reconciled.remoteObjectKey, "releases/p/1.0.0/windows/x64/installer/setup.exe");
  assert.equal(record.remoteObjectKey.includes("/unknown/"), true);
  await assert.rejects(() => reconcilePublishedArtifact({ ...record, publicationStatus: "NOT_PUBLISHED" }, provider, "https://downloads.example/", fetchOk), /PUBLISHED/);
  await assert.rejects(() => reconcilePublishedArtifact(record, provider, "https://downloads.example/", async () => new Response("bad", { status: 404 })), /public release URL/);
});
