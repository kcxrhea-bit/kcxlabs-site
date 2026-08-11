import { mediaRepository, metricsRepository, type Db } from "./db";
import { fetchStorageMetrics } from "./metrics";
import type { AppConfig } from "./config";
import { evaluateStorageBudget, type StorageBudget } from "../../../src/media/storage-budget";

export async function currentStorageBudget(
  db: Db,
  config: AppConfig,
  ownerId: string,
  incomingBytes: number,
): Promise<StorageBudget> {
  const localTrackedBytes = await mediaRepository(db).totalOnlineBytes(ownerId);
  let providerMetrics = null;
  if (config.analytics !== null) {
    const fetched = await fetchStorageMetrics(config.analytics, config.r2.bucket);
    if (fetched.ok) {
      providerMetrics = fetched.metrics;
      await metricsRepository(db).record({
        bucket: config.r2.bucket,
        payloadSizeBytes: fetched.metrics.storedBytes,
        metadataSizeBytes: 0,
        objectCount: fetched.metrics.objectCount,
        pendingUploadCount: fetched.metrics.pendingUploadCount,
        measuredAt: fetched.metrics.measuredAt,
      });
    }
  }
  if (providerMetrics === null) providerMetrics = await metricsRepository(db).latest(config.r2.bucket);
  return evaluateStorageBudget({ localTrackedBytes, providerMetrics, incomingBytes, now: new Date() });
}
