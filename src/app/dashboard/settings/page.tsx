"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Header } from "@/components/dashboard/Header";
import { User, Key, Shield, Save } from "lucide-react";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [openAiKey, setOpenAiKey] = useState("");
  const [stabilityKey, setStabilityKey] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(true);

  // Load existing API keys
  useEffect(() => {
    fetch("/api/user/api-keys")
      .then(r => r.json())
      .then(({ apiKeys }) => {
        if (apiKeys?.openai) setOpenAiKey(apiKeys.openai);
        if (apiKeys?.stability) setStabilityKey(apiKeys.stability);
      })
      .catch(() => {})
      .finally(() => setLoadingKeys(false));
  }, []);

  async function handleSaveKeys() {
    setSavingKeys(true);
    try {
      const apiKeys: Record<string, string> = {};
      if (openAiKey.trim()) apiKeys.openai = openAiKey.trim();
      if (stabilityKey.trim()) apiKeys.stability = stabilityKey.trim();

      const res = await fetch("/api/user/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeys }),
      });

      if (res.ok) {
        toast.success("API keys saved");
      } else {
        toast.error("Failed to save API keys");
      }
    } finally {
      setSavingKeys(false);
    }
  }

  const user = session?.user;
  const initials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : (user?.email?.[0] ?? "U").toUpperCase();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Settings" subtitle="Manage your account and preferences" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Profile */}
          <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#12121E] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
              <User size={15} className="text-[#4F8AFF]" />
              <h2 className="text-sm font-semibold text-[#F0F0F5]">Profile</h2>
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
                  <div className="text-sm font-medium text-[#F0F0F5]">{user?.name ?? "User"}</div>
                  <div className="text-xs text-[#5C5C78]">{user?.email ?? "—"}</div>
                </div>
              </div>
            </div>
          </section>

          {/* API Keys */}
          <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#12121E] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
              <Key size={15} className="text-[#8B5CF6]" />
              <h2 className="text-sm font-semibold text-[#F0F0F5]">API Keys</h2>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-[#5C5C78] leading-relaxed">
                Add your own API keys to use real AI execution. Keys are encrypted and stored securely.
              </p>

              {loadingKeys ? (
                <div className="text-xs text-[#5C5C78]">Loading…</div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#F0F0F5]">OpenAI API Key</label>
                    <input
                      type="password"
                      value={openAiKey}
                      onChange={e => setOpenAiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full h-8 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0B0B13] px-3 text-xs text-[#F0F0F5] placeholder:text-[#3A3A50] focus:outline-none focus:border-[#4F8AFF] transition-colors"
                    />
                    <p className="text-[10px] text-[#3A3A50]">Used by: Building Description (TR-003) + Concept Image (GN-003)</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#F0F0F5]">Stability AI Key</label>
                    <input
                      type="password"
                      value={stabilityKey}
                      onChange={e => setStabilityKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full h-8 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0B0B13] px-3 text-xs text-[#F0F0F5] placeholder:text-[#3A3A50] focus:outline-none focus:border-[#4F8AFF] transition-colors"
                    />
                    <p className="text-[10px] text-[#3A3A50]">Alternative for image generation</p>
                  </div>

                  <button
                    onClick={handleSaveKeys}
                    disabled={savingKeys}
                    className="flex items-center gap-2 rounded-lg bg-[#4F8AFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3D7AFF] transition-all disabled:opacity-60"
                  >
                    <Save size={11} />
                    {savingKeys ? "Saving…" : "Save API Keys"}
                  </button>
                </>
              )}
            </div>
          </section>

          {/* Plan */}
          <section className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#12121E] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
              <Shield size={15} className="text-[#10B981]" />
              <h2 className="text-sm font-semibold text-[#F0F0F5]">Plan & Usage</h2>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[#10B981]" />
                    <span className="text-sm font-bold text-[#F0F0F5]">Free Plan</span>
                  </div>
                  <p className="text-xs text-[#5C5C78] mt-1">50 executions / month</p>
                </div>
                <button className="rounded-lg bg-linear-to-r from-[#4F8AFF] to-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity">
                  Upgrade to Pro
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-[#5C5C78]">
                  <span>Executions this month</span>
                  <span>0 / 50</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#1A1A2A] overflow-hidden">
                  <div className="h-full w-0 rounded-full bg-[#4F8AFF]" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
