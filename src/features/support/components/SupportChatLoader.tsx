"use client";

import dynamic from "next/dynamic";

const SupportChatWidget = dynamic(
  () => import("./SupportChatWidget").then((m) => m.SupportChatWidget),
  { ssr: false },
);

export function SupportChatLoader() {
  return <SupportChatWidget />;
}
