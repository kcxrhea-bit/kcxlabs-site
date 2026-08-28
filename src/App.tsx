import { AppShell } from "./components/layout/AppShell";
import { BetaPage } from "./components/pages/BetaPage";
import { DownloadsPage } from "./components/pages/DownloadsPage";
import { ClipsPage, SharePage } from "./components/pages/MediaPublicPages";
import { NexusCloudPage } from "./components/pages/NexusCloudPage";
import { NexusCloudPortalPage } from "./components/pages/NexusCloudPortalPage";
import { EcosystemSection } from "./components/sections/EcosystemSection";
import { FuturePreviewSection } from "./components/sections/FuturePreviewSection";
import { HeroSection } from "./components/sections/HeroSection";
import { MobileAiSection } from "./components/sections/MobileAiSection";
import { ProjectsPreviewSection } from "./components/sections/ProjectsPreviewSection";
import { RoboticsSection } from "./components/sections/RoboticsSection";
import { StudioSpotlight } from "./components/sections/StudioSpotlight";
import { SubsystemModulesSection } from "./components/sections/SubsystemModulesSection";
import { DesktopApp } from "./desktop/DesktopApp";
import { resolvePublicRoute } from "./routes";

export default function App() {
  if (window.kcxDesktop) {
    return <DesktopApp />;
  }

  const route = resolvePublicRoute(window.location.pathname);

  return (
    <AppShell>
      {route === "beta" ? (
        <BetaPage />
      ) : route === "downloads" ? (
        <DownloadsPage />
      ) : route === "nexus" ? (
        <NexusCloudPage />
      ) : route === "nexus-portal" ? (
        <NexusCloudPortalPage />
      ) : route === "clips" ? (
        <ClipsPage />
      ) : route === "share" ? (
        <SharePage />
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
