"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Header } from "@/components/dashboard/Header";
import Link from "next/link";
import { User, Key, Shield, Save, Loader2, AlertCircle } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

export default function SettingsPage() {
  const { t } = useLocale();
  const { data: session } = useSession();
  const [openAiKey, setOpenAiKey] = useState("");
  const [stabilityKey, setStabilityKey] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load existing API keys
  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    fetch("/api/user/api-keys", { signal: controller.signal })
      .then(r => {
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then(({ apiKeys }) => {
        if (apiKeys?.openai) setOpenAiKey(apiKeys.openai);
        if (apiKeys?.stability) setStabilityKey(apiKeys.stability);
        setLoadError(null);
      })
      .catch((err) => {
        const errorMsg = err instanceof Error && err.name === 'AbortError' 
          ? "Request timed out" 
          : "Failed to load API keys";
        setLoadError(errorMsg);
        toast.error(errorMsg);
      })
      .finally(() => setLoadingKeys(false));

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  async function handleSaveKeys() {
    if (!openAiKey.trim() && !stabilityKey.trim()) {
      toast.error(t('settings.enterAtLeastOne'));
      return;
    }

    setSavingKeys(true);
    try {
      const apiKeys: Record<string, string> = {};
      if (openAiKey.trim()) apiKeys.openai = openAiKey.trim();
      if (stabilityKey.trim()) apiKeys.stability = stabilityKey.trim();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch("/api/user/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeys }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        toast.success(t('settings.saveSuccess'));
      } else {
        throw new Error(`API returned ${res.status}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error && err.name === 'AbortError' 
        ? "Request timed out" 
        : t('settings.saveFailed');
      toast.error(errorMsg);
    } finally {
      setSavingKeys(false);
    }
  }

  const user = session?.user;
  const userRole = (user as { role?: string } | undefined)?.role || "FREE";
  const initials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : (user?.email?.[0] ?? "U").toUpperCase();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Profile */}
          <section className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(18,18,30,0.95)] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.05)]">
              <User size={15} className="text-[#4F8AFF]" />
              <h2 className="text-sm font-semibold text-[#F0F0F5] tracking-[-0.01em]">{t('settings.profile')}</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#4F8AFF] to-[#8B5CF6] flex items-center justify-center text-lg font-bold text-white overflow-hidden">
                  {user?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium text-[#F0F0F5]">{user?.name ?? t('settings.user')}</div>
                  <div className="text-xs text-[#5C5C78]">{user?.email ?? "—"}</div>
                </div>
              </div>
            </div>
          </section>

          {/* API Keys */}
          <section className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(18,18,30,0.95)] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.05)]">
              <Key size={15} className="text-[#8B5CF6]" />
              <h2 className="text-sm font-semibold text-[#F0F0F5] tracking-[-0.01em]">{t('settings.apiKeys')}</h2>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-[#5C5C78] leading-relaxed">
                {t('settings.apiKeysDesc')}
              </p>

              {loadingKeys ? (
                <div className="flex items-center gap-2 text-xs text-[#5C5C78] py-4">
                  <Loader2 size={14} className="animate-spin" />
                  {t('settings.loadingKeys')}
                </div>
              ) : loadError ? (
                <div className="p-4 rounded-lg border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)]">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle size={14} className="text-[#EF4444]" />
                    <span className="text-xs font-semibold text-[#EF4444]">{loadError}</span>
                  </div>
                  <p className="text-[10px] text-[#8888A0] mb-3">
                    {t('settings.loadError')}
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="text-[10px] text-[#4F8AFF] hover:underline"
                  >
                    {t('settings.tryAgain')}
                  </button>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#F0F0F5]">{t('settings.openaiKey')}</label>
                <input
                  type="password"
                  value={openAiKey}
                  onChange={e => setOpenAiKey(e.target.value)}
                  placeholder="sk-..."
                  disabled={loadingKeys}
                  className="w-full h-8 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(7,7,13,0.8)] px-3 text-xs text-[#F0F0F5] placeholder:text-[#3A3A50] focus:outline-none focus:border-[#4F8AFF] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-[10px] text-[#3A3A50]">{t('settings.openaiUsage')}</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#F0F0F5]">{t('settings.stabilityKey')}</label>
                <input
                  type="password"
                  value={stabilityKey}
                  onChange={e => setStabilityKey(e.target.value)}
                  placeholder="sk-..."
                  disabled={loadingKeys}
                  className="w-full h-8 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(7,7,13,0.8)] px-3 text-xs text-[#F0F0F5] placeholder:text-[#3A3A50] focus:outline-none focus:border-[#4F8AFF] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-[10px] text-[#3A3A50]">{t('settings.stabilityUsage')}</p>
              </div>

              <button
                onClick={handleSaveKeys}
                disabled={savingKeys || loadingKeys}
                className="flex items-center gap-2 rounded-lg bg-[#4F8AFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3D7AFF] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {savingKeys ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    {t('settings.saving')}
                  </>
                ) : (
                  <>
                    <Save size={11} />
                    {t('settings.saveApiKeys')}
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Plan */}
          <section className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(18,18,30,0.95)] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.05)]">
              <Shield size={15} className="text-[#10B981]" />
              <h2 className="text-sm font-semibold text-[#F0F0F5] tracking-[-0.01em]">{t('settings.planUsage')}</h2>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${userRole !== "FREE" ? "bg-[#4F8AFF]" : "bg-[#10B981]"}`} />
                    <span className="text-sm font-bold text-[#F0F0F5]">
                      {userRole === "FREE" ? t('settings.freePlan') : userRole === "PRO" ? t('settings.proPlan') : t('settings.teamPlan')}
                    </span>
                  </div>
                  <p className="text-xs text-[#5C5C78] mt-1">
                    {userRole === "FREE" ? t('settings.threeRunsPerDay') : t('settings.unlimitedRuns')}
                  </p>
                </div>
                {userRole === "FREE" && (
                  <Link
                    href="/dashboard/billing"
                    className="rounded-lg bg-gradient-to-r from-[#4F8AFF] to-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                  >
                    {t('settings.upgradeToPro')}
                  </Link>
                )}
                {userRole !== "FREE" && (
                  <span className="rounded-lg bg-[rgba(79,138,255,0.1)] border border-[rgba(79,138,255,0.2)] px-3 py-1.5 text-xs font-semibold text-[#4F8AFF]">
                    {t('settings.active')}
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
