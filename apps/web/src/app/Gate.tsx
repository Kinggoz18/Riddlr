import { EmptyState, Skeleton } from "@riddlr/ui";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api } from "./api.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { AssetPage } from "./pages/AssetPage.js";
import { EventDetailPage } from "./pages/EventDetailPage.js";
import { EventsPage } from "./pages/EventsPage.js";
import { HealthPage } from "./pages/HealthPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { NotificationsPage } from "./pages/NotificationsPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { PortfoliosPage } from "./pages/PortfoliosPage.js";
import { ScansPage } from "./pages/ScansPage.js";
import { ScorecardPage } from "./pages/ScorecardPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { SetupPage } from "./pages/SetupPage.js";
import { SignalDetailPage } from "./pages/SignalDetailPage.js";
import { SignalsPage } from "./pages/SignalsPage.js";
import { SkillsPage } from "./pages/SkillsPage.js";
import { SourcesPage } from "./pages/SourcesPage.js";
import { UsagePage } from "./pages/UsagePage.js";
import { WatchlistsPage } from "./pages/WatchlistsPage.js";
import { Shell } from "./Shell.js";

export function Gate() {
  const [ready, setReady] = useState<"setup" | "login" | "app" | "loading" | "error">("loading");
  const [error, setError] = useState<string>();
  useEffect(() => {
    void (async () => {
      try {
        const setup = await api<{ completed: boolean }>("/api/v1/setup/status");
        if (!setup.completed) {
          setReady("setup");
          return;
        }
        try {
          const me = await api<{ twoFactorSatisfied: boolean }>("/api/v1/me");
          setReady(me.twoFactorSatisfied ? "app" : "login");
        } catch {
          setReady("login");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to reach Riddlr.");
        setReady("error");
      }
    })();
  }, []);
  if (ready === "loading") {
    return <Skeleton label="Loading…" />;
  }
  if (ready === "error") {
    return (
      <EmptyState
        asPageTitle
        title="Can’t reach Riddlr"
        body={error ?? "Check the server, then retry."}
      />
    );
  }
  if (ready === "setup") {
    return <SetupPage />;
  }
  if (ready === "login") {
    return <LoginPage />;
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/signals" element={<SignalsPage />} />
        <Route path="/signals/:id" element={<SignalDetailPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/scorecard" element={<ScorecardPage />} />
        <Route path="/agents/*" element={<AgentsPage />} />
        <Route path="/skills/*" element={<SkillsPage />} />
        <Route path="/sources/*" element={<SourcesPage />} />
        <Route path="/watchlists/*" element={<WatchlistsPage />} />
        <Route path="/assets/:canonicalId" element={<AssetPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/portfolios/*" element={<PortfoliosPage />} />
        <Route path="/scans" element={<ScansPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/settings/*" element={<SettingsPage />} />
      </Routes>
    </Shell>
  );
}
