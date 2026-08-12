import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
const preload = await readFile(new URL("../electron/preload.ts", import.meta.url), "utf8");

test("Electron main window keeps renderer Node integration disabled", () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
});

test("preload exposes the typed desktop bridge only", () => {
  assert.match(preload, /contextBridge\.exposeInMainWorld\("kcxDesktop", desktopApi\)/);
  assert.doesNotMatch(preload, /sendSync|eval|executeJavaScript/);
});

test("Media Center picker enables multi-select and returns all selected paths for safe description", () => {
  assert.match(main, /properties:\s*\["openFile",\s*"multiSelections"\]/);
  assert.match(main, /media\.describeFiles\(selection\.filePaths\)/);
});
