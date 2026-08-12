import type { MediaLocalFile, MediaUploadRecord } from "../shared/desktop";

export type MediaQueueItem = MediaLocalFile & {
  status: "queued" | "processing" | "complete" | "failed";
  record: MediaUploadRecord | null;
  error: string | null;
};

export function mediaPathKey(filePath: string): string {
  return filePath.replace(/\//g, "\\").toLocaleLowerCase();
}

export function appendUniqueMediaFiles(queue: MediaQueueItem[], files: MediaLocalFile[]): MediaQueueItem[] {
  const known = new Set(queue.map((item) => mediaPathKey(item.filePath)));
  const additions = files.filter((file) => {
    const key = mediaPathKey(file.filePath);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  return [...queue, ...additions.map((file) => ({ ...file, status: "queued" as const, record: null, error: null }))];
}

export async function processMediaQueueSequentially(
  items: MediaQueueItem[],
  process: (filePath: string) => Promise<MediaUploadRecord>,
  update: (filePath: string, patch: Partial<MediaQueueItem>) => void,
): Promise<void> {
  for (const item of items) {
    if (item.status !== "queued") continue;
    update(item.filePath, { status: "processing", error: null });
    try {
      const record = await process(item.filePath);
      const successful = record.stage === "moved" || (record.stage === "finalized" && record.moveError !== null);
      update(item.filePath, {
        record,
        status: successful ? "complete" : "failed",
        error: successful ? null : record.error ?? "Media processing did not complete.",
      });
    } catch (error) {
      update(item.filePath, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
}
