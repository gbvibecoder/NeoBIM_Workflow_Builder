"use client";

import dynamic from "next/dynamic";

/* Dynamic import with SSR disabled — web-ifc uses WASM which can't run server-side */
const IFCViewerPage = dynamic(
  () => import("@/features/ifc/components/IFCViewerPage"),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: "#07070D",
          color: "#5C5C78",
          fontSize: 14,
        }}
      >
        Loading IFC Viewer...
      </div>
    ),
  }
);

export default function Page() {
  return <IFCViewerPage />;
}
