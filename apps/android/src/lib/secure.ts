import { SecureStorage } from "@aparajita/capacitor-secure-storage";

export type DeviceCredential = { token: string; deviceName: string; expiresAt: string };
const credentialKey = "device-credential";

export async function loadCredential(): Promise<DeviceCredential | null> {
  await SecureStorage.setKeyPrefix("kcx-labs-media_");
  const value = await SecureStorage.get(credentialKey);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<DeviceCredential>;
  return typeof candidate.token === "string" && typeof candidate.deviceName === "string" && typeof candidate.expiresAt === "string" ? candidate as DeviceCredential : null;
}

export async function saveCredential(credential: DeviceCredential): Promise<void> {
  await SecureStorage.setKeyPrefix("kcx-labs-media_");
  await SecureStorage.set(credentialKey, credential);
}

export async function clearCredential(): Promise<void> {
  await SecureStorage.setKeyPrefix("kcx-labs-media_");
  await SecureStorage.remove(credentialKey);
}
