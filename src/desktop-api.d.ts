import type { DesktopApi } from "./shared/desktop";

declare global {
  interface Window {
    kcxDesktop?: DesktopApi;
  }
}

export {};
