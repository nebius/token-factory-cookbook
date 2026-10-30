import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { AppShell } from "./components/AppShell";
import { ClusterPage } from "./pages/ClusterPage";
import { ExperimentsPage } from "./pages/ExperimentsPage";
import { RunPage } from "./pages/RunPage";
import { ReportPage } from "./pages/ReportPage";
import { RunsPage } from "./pages/RunsPage";
import { ResultsPage } from "./pages/ResultsPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<ClusterPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<RunPage />} />
          <Route path="/runs/:runId/report" element={<ReportPage />} />
          <Route path="/results" element={<ResultsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
