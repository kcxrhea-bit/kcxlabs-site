import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Header } from "./Header";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-kcx-black text-kcx-steel">
      <div className="fixed inset-0 -z-10 bg-kcx-atmosphere" />
      <div className="fixed inset-0 -z-10 bg-kcx-grid" />
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-56 bg-[linear-gradient(180deg,rgba(255,122,26,0.12),transparent)]" />
      <a href="#main-content" className="skip-link focus-ring">
        Skip to content
      </a>
      <Header />
      <main id="main-content">{children}</main>
      <Footer />
    </div>
  );
}
