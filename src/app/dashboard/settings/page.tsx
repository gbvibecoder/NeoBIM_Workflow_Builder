"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { SettingsHero } from "@/features/dashboard/components/settings/SettingsHero";
import { SettingsSidebar } from "@/features/dashboard/components/settings/SettingsSidebar";
import { ProfileTab } from "@/features/dashboard/components/settings/ProfileTab";
import { ApiKeysTab } from "@/features/dashboard/components/settings/ApiKeysTab";
import { PlanTab } from "@/features/dashboard/components/settings/PlanTab";
import { SecurityTab } from "@/features/dashboard/components/settings/SecurityTab";
import s from "@/features/dashboard/components/settings/settings.module.css";

export type SettingsTab = "profile" | "api-keys" | "plan" | "security";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  const user = session?.user;
  const userRole = (user as { role?: string } | undefined)?.role || "FREE";

  return (
    <div className={s.settingsPage}>
      <div className={s.backdrop} aria-hidden="true" />
      <div className={s.container}>
        <SettingsHero
          userName={user?.name ?? "Architect"}
          plan={userRole}
        />
        <div className={s.layout}>
          <SettingsSidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
          <div className={s.content}>
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "api-keys" && <ApiKeysTab />}
            {activeTab === "plan" && <PlanTab />}
            {activeTab === "security" && <SecurityTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
