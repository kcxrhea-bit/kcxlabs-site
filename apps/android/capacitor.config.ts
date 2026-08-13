import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.kcxlabs.media",
  appName: "KCx Labs Media",
  webDir: "dist",
  android: { allowMixedContent: false, loggingBehavior: "none" },
};

export default config;
