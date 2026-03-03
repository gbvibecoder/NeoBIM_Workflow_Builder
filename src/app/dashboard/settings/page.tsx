import { Header } from "@/components/dashboard/Header";
import { User, Key, Bell, Shield, Palette } from "lucide-react";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Settings" subtitle="Manage your account and preferences" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Profile */}
          <section className="rounded-xl border border-[#1E1E2E] bg-[#12121A] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1E1E2E]">
              <User size={15} className="text-[#4F8AFF]" />
              <h2 className="text-sm font-semibold text-[#F0F0F5]">Profile</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#4F8AFF] to-[#8B5CF6] flex items-center justify-center text-lg font-bold text-white">
                  U
                </div>
                <div>
                  <div className="text-sm font-medium text-[#F0F0F5]">User Name</div>
                  <div className="text-xs text-[#55556A]">user@example.com</div>
                </div>
                <button className="ml-auto rounded-lg border border-[#2A2A3E] bg-[#1A1A26] px-3 py-1.5 text-xs text-[#8888A0] hover:text-[#F0F0F5] hover:border-[#3A3A4E] transition-all">
                  Edit Profile
                </button>
              </div>
            </div>
          </section>

          {/* API Keys */}
          <section className="rounded-xl border border-[#1E1E2E] bg-[#12121A] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1E1E2E]">
              <Key size={15} className="text-[#8B5CF6]" />
              <h2 className="text-sm font-semibold text-[#F0F0F5]">API Keys</h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-[#55556A] leading-relaxed">
                Add your own API keys to use with nodes. Platform-managed keys are used by default.
              </p>
              {[
                { label: "OpenAI API Key", placeholder: "sk-...", hint: "Used by: Requirements Extractor, Image Generator" },
                { label: "Stability AI Key", placeholder: "sk-...", hint: "Alternative for image generation" },
                { label: "Azure Document Intelligence", placeholder: "Endpoint URL", hint: "Used by: Document Parser" },
              ].map((field) => (
                <div key={field.label} className="space-y-1.5">
                  <label className="text-xs font-medium text-[#F0F0F5]">{field.label}</label>
                  <input
                    type="password"
                    placeholder={field.placeholder}
                    className="w-full h-8 rounded-lg border border-[#2A2A3E] bg-[#0A0A0F] px-3 text-xs text-[#F0F0F5] placeholder:text-[#3A3A4E] focus:outline-none focus:border-[#4F8AFF] transition-colors"
                  />
                  <p className="text-[10px] text-[#3A3A4E]">{field.hint}</p>
                </div>
              ))}
              <button className="rounded-lg bg-[#4F8AFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3D7AFF] transition-all mt-2">
                Save API Keys
              </button>
            </div>
          </section>

          {/* Plan */}
          <section className="rounded-xl border border-[#1E1E2E] bg-[#12121A] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1E1E2E]">
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
                  <p className="text-xs text-[#55556A] mt-1">50 executions / month</p>
                </div>
                <button className="rounded-lg bg-gradient-to-r from-[#4F8AFF] to-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity">
                  Upgrade to Pro
                </button>
              </div>

              {/* Usage bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-[#55556A]">
                  <span>Executions this month</span>
                  <span>0 / 50</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#1A1A26] overflow-hidden">
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
