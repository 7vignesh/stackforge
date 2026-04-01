import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ToastProvider } from "@stackforge/ui";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { JobPage } from "./pages/JobPage";

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/jobs/:jobId" element={<JobPage />} />
          </Routes>
        </Layout>
      </ToastProvider>
    </BrowserRouter>
  );
}
