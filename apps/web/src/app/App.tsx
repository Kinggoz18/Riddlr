import { Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Gate } from "./Gate.js";
import { ResetPage } from "./pages/ResetPage.js";

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/reset" element={<ResetPage />} />
        <Route path="*" element={<Gate />} />
      </Routes>
    </ErrorBoundary>
  );
}
