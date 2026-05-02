"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertCircle, Cpu, Activity, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ApiKeyRow } from "./ApiKeyRow";
import s from "./settings.module.css";

export function ApiKeysTab() {
  const { t } = useLocale();
  const [openAiKey, setOpenAiKey] = useState("");
  const [stabilityKey, setStabilityKey] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Tracks the latest in-flight load. Older calls become "stale".
  const loadIdRef = useRef(0);

  const loadKeys = useCallback(async () => {
    const myId = ++loadIdRef.current;
    setLoadingKeys(true);
    setLoadError(null);

    const isStale = () => loadIdRef.current !== myId;

    const attemptFetch = async (timeoutMs: number) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await fetch("/api/user/api-keys", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return (await r.json()) as { apiKeys?: { openai?: string; stability?: string } };
      } finally {
        clearTimeout(timeoutId);
      }
    };

    try {
      let data;
      try {
        data = await attemptFetch(25000);
      } catch (firstErr) {
        if (isStale()) return;
        const isHttpError =
          firstErr instanceof Error && firstErr.message.startsWith("API returned ");
        if (isHttpError) throw firstErr;
        data = await attemptFetch(25000);
      }
      if (isStale()) return;
      if (data.apiKeys?.openai) setOpenAiKey(data.apiKeys.openai);
      if (data.apiKeys?.stability) setStabilityKey(data.apiKeys.stability);
      setLoadError(null);
    } catch (err) {
      if (isStale()) return;
      const isTimeout = err instanceof Error && err.name === "AbortError";
      setLoadError(isTimeout ? t("toast.requestTimeout") : t("toast.loadKeysFailed"));
    } finally {
      if (!isStale()) setLoadingKeys(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadKeys();
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadIdRef.current++;
    };
  }, [loadKeys]);

  async function handleSaveKeys() {
    if (!openAiKey.trim() && !stabilityKey.trim()) {
      toast.error(t("settings.enterAtLeastOne"));
      return;
    }
    setSaveStatus("saving");
    try {
      const apiKeys: Record<string, string> = {};
      if (openAiKey.trim()) apiKeys.openai = openAiKey.trim();
      if (stabilityKey.trim()) apiKeys.stability = stabilityKey.trim();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const res = await fetch("/api/user/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeys }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        setSaveStatus("saved");
        toast.success(t("settings.saveSuccess"));
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        throw new Error(`API returned ${res.status}`);
      }
    } catch (err) {
      setSaveStatus("idle");
      const errorMsg = err instanceof Error && err.name === "AbortError"
        ? t("toast.requestTimeout")
        : t("settings.saveFailed");
      toast.error(errorMsg);
    }
  }

  return (
    <div>
      {/* Section header */}
      <div className={s.section} style={{ marginBottom: 20 }}>
        <div className={s.sectionStrip}>
          <span className={s.sectionStripNum}>FB-S02 &middot; {t("settings.byoAiTitle")}</span>
          <span className={s.sectionStripRight}>{t("settings.optional")}</span>
        </div>
        <div className={s.sectionBody}>
          <p style={{ fontSize: 13, color: "var(--rs-text, #5A6478)", lineHeight: 1.6, margin: 0 }}>
            {t("settings.byoAiDesc")}
          </p>
        </div>
      </div>

      {/* Loading / error */}
      {loadingKeys && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "20px 0", color: "var(--rs-text-mute)" }}>
          <Loader2 size={14} className={s.spinner} />
          <span style={{ fontSize: 13 }}>{t("settings.loadingKeys")}</span>
        </div>
      )}
      {loadError && (
        <div style={{
          padding: 16, borderRadius: 10, marginBottom: 16,
          border: "1px solid var(--danger-mid)", background: "var(--danger-tint)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <AlertCircle size={14} style={{ color: "var(--danger)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)" }}>{loadError}</span>
          </div>
          <p style={{ fontSize: 11, color: "var(--rs-text-mute)", margin: "0 0 8px" }}>
            {t("settings.loadError")}
          </p>
          <button
            onClick={() => loadKeys()}
            style={{
              fontSize: 11, color: "var(--plan-blueprint)", background: "none",
              border: "none", cursor: "pointer", padding: 0,
            }}
          >
            {t("settings.tryAgain")}
          </button>
        </div>
      )}

      {!loadingKeys && !loadError && (
        <>
          {/* OpenAI key */}
          <ApiKeyRow
            stripNum="FB-K01"
            stripLabel="OpenAI"
            icon={<Cpu size={16} />}
            name="OpenAI"
            tagline={t("settings.openaiTagline")}
            value={openAiKey}
            onChange={setOpenAiKey}
            placeholder="sk-..."
            disabled={loadingKeys}
          />

          {/* Stability key */}
          <ApiKeyRow
            stripNum="FB-K02"
            stripLabel="Stability AI"
            icon={<Activity size={16} />}
            name="Stability AI"
            tagline={t("settings.stabilityTagline")}
            value={stabilityKey}
            onChange={setStabilityKey}
            placeholder="sk-..."
            disabled={loadingKeys}
          />

          {/* Save bar */}
          <div className={s.keySaveBar}>
            <div className={s.keySaveNote}>{t("settings.keysStoredNote")}</div>
            <button
              className={s.keySaveBtn}
              data-saved={saveStatus === "saved" ? "true" : "false"}
              disabled={saveStatus === "saving" || loadingKeys || (!openAiKey.trim() && !stabilityKey.trim())}
              onClick={handleSaveKeys}
            >
              {saveStatus === "saving" ? (
                <><Loader2 size={14} className={s.spinner} /> {t("settings.saving")}</>
              ) : saveStatus === "saved" ? (
                <><CheckCircle2 size={14} /> Saved</>
              ) : (
                t("settings.saveKeys")
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
