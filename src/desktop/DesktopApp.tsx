import { useEffect, useState } from "react";
import {
  Activity,
  Boxes,
  CloudUpload,
  FileText,
  FolderKanban,
  Gauge,
  History,
  MonitorPlay,
  Palette,
  Rocket,
  Settings,
} from "lucide-react";
import type { DesktopStatus } from "../shared/desktop";
import "./desktop.css";

const navigation = [
  [Gauge, "Dashboard"],
  [FolderKanban, "Projects"],
  [Rocket, "Release Publisher"],
  [FileText, "Website"],
  [MonitorPlay, "Website Preview"],
  [CloudUpload, "Deployment"],
  [Palette, "Theme Sync"],
  [History, "Release History"],
  [Activity, "Activity"],
  [Settings, "Settings"],
] as const;

const telemetry = [
  ["Website build", "Ready", "healthy"],
  ["Deployment", "Not queued", "neutral"],
  ["Release pipeline", "Awaiting project", "neutral"],
  ["Theme source", "Phase 4", "neutral"],
] as const;

export function DesktopApp() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);

  useEffect(() => {
    void window.kcxDesktop?.getStatus().then(setStatus);
  }, []);

  return (
    <main className="desktop-app">
      <aside className="desktop-nav" aria-label="Desktop navigation">
        <div className="desktop-brand"><Boxes size={20} /> KCx Labs</div>
        <p className="desktop-kicker">Publishing system</p>
        <nav>
          {navigation.map(([Icon, label], index) => (
            <button className={index === 0 ? "desktop-nav-item desktop-nav-item-active" : "desktop-nav-item"} key={label} type="button">
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>
        <div className="desktop-nav-footer">Desktop shell · Phase 1</div>
      </aside>

      <section className="desktop-workspace">
        <div className="desktop-art" aria-hidden="true" />
        <header className="desktop-header">
          <div>
            <p className="desktop-kicker">KCx publishing command</p>
            <h1>Dashboard</h1>
          </div>
          <span className="desktop-status"><i /> Desktop connected</span>
        </header>

        <div className="desktop-grid">
          {telemetry.map(([label, value, tone]) => (
            <article className="desktop-card desktop-telemetry" key={label}>
              <p>{label}</p><strong className={tone}>{value}</strong>
            </article>
          ))}
        </div>

        <section className="desktop-card desktop-primary-card">
          <div>
            <p className="desktop-kicker">Release Publisher</p>
            <h2>The publishing pipeline starts here.</h2>
            <p>Register a KCx project to prepare artifacts, release metadata, website updates, and deployment readiness.</p>
          </div>
          <button type="button" className="desktop-action">Open Projects <FolderKanban size={16} /></button>
        </section>

        <section className="desktop-card desktop-system-card">
          <div>
            <p className="desktop-kicker">Secure desktop architecture</p>
            <h2>Website remains independent.</h2>
            <p>The renderer has no Node access. Desktop capabilities are exposed only through a typed, isolated preload bridge.</p>
          </div>
          <dl>
            <div><dt>Electron</dt><dd>{status?.electronVersion ?? "Connecting"}</dd></div>
            <div><dt>App version</dt><dd>{status?.applicationVersion ?? "Connecting"}</dd></div>
            <div><dt>Platform</dt><dd>{status?.platform ?? "Connecting"}</dd></div>
          </dl>
        </section>
      </section>
    </main>
  );
}
