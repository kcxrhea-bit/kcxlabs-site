import { useState } from "react";
import { Menu, Terminal, X } from "lucide-react";
import { navigationItems } from "../../data/navigation";

export function Header() {
  const [isOpen, setIsOpen] = useState(false);

  const closeMenu = () => setIsOpen(false);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-kcx-black/68 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-kcx-orange/35 to-transparent" />
      <nav className="mx-auto flex h-[4.35rem] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Primary navigation">
        <a
          href="#home"
          onClick={closeMenu}
          className="group flex items-center gap-3 text-sm font-semibold tracking-[0.22em] text-white focus-ring"
        >
          <span className="grid size-9 place-items-center border border-kcx-orange/45 bg-gradient-to-br from-kcx-forge to-black shadow-[0_0_28px_rgba(255,122,26,0.12)] transition group-hover:border-kcx-orange">
            <Terminal size={18} className="text-kcx-orange" />
          </span>
          KCx Labs
        </a>
        <div className="hidden items-center rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 lg:flex">
          {navigationItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-full px-3 py-2 text-[0.68rem] uppercase tracking-[0.17em] text-kcx-ash transition duration-300 hover:bg-white/[0.055] hover:text-kcx-orange focus-ring"
            >
              {item.label}
            </a>
          ))}
        </div>
        <button
          type="button"
          className="grid size-10 place-items-center border border-white/10 bg-white/[0.045] text-kcx-steel shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] lg:hidden"
          aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={isOpen}
          aria-controls="mobile-navigation"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>
      <div
        id="mobile-navigation"
        className={`mobile-nav-panel lg:hidden ${isOpen ? "mobile-nav-panel-open" : ""}`}
      >
        <nav className="grid gap-2" aria-label="Mobile navigation">
          {navigationItems.map((item) => (
            <a key={item.label} href={item.href} onClick={closeMenu} className="mobile-nav-link focus-ring">
              <span>{item.label}</span>
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-kcx-ash">{item.href}</span>
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
