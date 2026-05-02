"use client";

import { User, Key, Shield, Lock } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import { CONTACT_EMAIL } from "@/constants/contact";
import type { SettingsTab } from "@/app/dashboard/settings/page";
import s from "./settings.module.css";

interface SettingsSidebarProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

const TABS: Array<{
  key: SettingsTab;
  num: string;
  icon: typeof User;
  labelKey: TranslationKey;
  descKey: TranslationKey;
}> = [
  { key: "profile",  num: "FB-S01", icon: User,   labelKey: "settings.tabProfileLabel",  descKey: "settings.tabProfileDesc" },
  { key: "api-keys", num: "FB-S02", icon: Key,    labelKey: "settings.tabApiKeysLabel",  descKey: "settings.tabApiKeysDesc" },
  { key: "plan",     num: "FB-S03", icon: Shield, labelKey: "settings.tabPlanLabel",     descKey: "settings.tabPlanDesc" },
  { key: "security", num: "FB-S04", icon: Lock,   labelKey: "settings.tabSecurityLabel", descKey: "settings.tabSecurityDesc" },
];

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  const { t } = useLocale();

  return (
    <aside className={s.sidebar}>
      {/* Drafting strip */}
      <div className={s.sidebarStrip}>
        <span className={s.sidebarStripLeft}>{t("settings.sidebarSections")}</span>
        <span className={s.sidebarStripRight}>4 items</span>
      </div>

      {/* Navigation */}
      <nav className={s.sidebarNav}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              className={s.navItem}
              data-active={activeTab === tab.key ? "true" : "false"}
              onClick={() => onTabChange(tab.key)}
            >
              <span className={s.navItemNum}>{tab.num}</span>
              <span className={s.navItemIcon}><Icon size={16} /></span>
              <span className={s.navItemBody}>
                <span className={s.navItemLabel}>{t(tab.labelKey)}</span>
                <span className={s.navItemDesc}>{t(tab.descKey)}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={s.sidebarFooter}>
        <div className={s.sidebarFooterTag}>{t("settings.sidebarHelpTag")}</div>
        <div className={s.sidebarFooterText}>
          {t("settings.sidebarHelpText")}{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={s.sidebarFooterLink}>{CONTACT_EMAIL}</a>
        </div>
      </div>
    </aside>
  );
}
