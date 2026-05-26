import { AppShell } from "./components/layout/AppShell";
import { BetaPage } from "./components/pages/BetaPage";
import { EcosystemSection } from "./components/sections/EcosystemSection";
import { FuturePreviewSection } from "./components/sections/FuturePreviewSection";
import { HeroSection } from "./components/sections/HeroSection";
import { MobileAiSection } from "./components/sections/MobileAiSection";
import { ProjectsPreviewSection } from "./components/sections/ProjectsPreviewSection";
import { RoboticsSection } from "./components/sections/RoboticsSection";
import { StudioSpotlight } from "./components/sections/StudioSpotlight";
import { SubsystemModulesSection } from "./components/sections/SubsystemModulesSection";

export default function App() {
  const isBetaRoute = window.location.pathname.replace(/\/$/, "") === "/beta";

  return (
    <AppShell>
      {isBetaRoute ? (
        <BetaPage />
      ) : (
        <>
          <HeroSection />
          <EcosystemSection />
          <ProjectsPreviewSection />
          <StudioSpotlight />
          <MobileAiSection />
          <SubsystemModulesSection />
          <RoboticsSection />
          <FuturePreviewSection />
        </>
      )}
    </AppShell>
  );
}
