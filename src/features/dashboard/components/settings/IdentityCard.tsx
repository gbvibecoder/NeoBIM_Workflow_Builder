"use client";

import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { Camera, Pencil, Trash2, Shield, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useAvatar, primeAvatarCache } from "@/hooks/useAvatar";
import { EmailVerificationRow } from "./EmailVerificationRow";
import { PhoneVerificationRow } from "./PhoneVerificationRow";
import s from "./settings.module.css";

interface ProfileData {
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneVerified: boolean;
  createdAt: string | null;
  role: string;
}

interface IdentityCardProps {
  user: { name?: string | null; email?: string | null; image?: string | null } | undefined;
  initials: string;
  profileData: ProfileData;
  setProfileData: React.Dispatch<React.SetStateAction<ProfileData>>;
  onSessionUpdate: () => Promise<unknown>;
}

export function IdentityCard({
  user,
  initials,
  profileData,
  setProfileData,
  onSessionUpdate,
}: IdentityCardProps) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(0); // generation counter to prevent race conditions
  const [editName, setEditName] = useState(user?.name ?? "");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isHoveringAvatar, setIsHoveringAvatar] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);

  // Fetch actual avatar (handles "uploaded" sentinel)
  const loadedImage = useAvatar(user?.image);

  // Sync name from session
  useEffect(() => {
    if (user?.name && !isEditingName) setEditName(user.name);
  }, [user?.name, isEditingName]);

  // The displayed image: preview (pending upload) > loaded (from API/session)
  const displayImage = previewImage ?? loadedImage;
  const hasImageToRemove = !!(previewImage || loadedImage);

  const planLabel =
    profileData.role === "FREE" ? "Free" :
    profileData.role === "MINI" ? "Mini" :
    profileData.role === "STARTER" ? "Starter" :
    profileData.role === "PRO" ? "Pro" :
    profileData.role === "TEAM_ADMIN" ? "Team" :
    profileData.role === "PLATFORM_ADMIN" ? "Admin" : profileData.role;

  function processImage(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("settings.imageTooLarge"));
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(t("settings.invalidImageType"));
      return;
    }
    // Increment generation counter — only the latest selection wins
    const generation = ++processingRef.current;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (processingRef.current !== generation) return; // stale
      const img = new Image();
      img.onload = () => {
        if (processingRef.current !== generation) return; // stale
        const canvas = document.createElement("canvas");
        const TARGET = 200;
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        canvas.width = TARGET;
        canvas.height = TARGET;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, TARGET, TARGET);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        setPreviewImage(dataUrl);
        autoSaveAvatar(dataUrl);
      };
      img.onerror = () => {
        if (processingRef.current !== generation) return;
        toast.error(t("settings.invalidImageType"));
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      if (processingRef.current !== generation) return;
      toast.error(t("settings.profileSaveFailed"));
    };
    reader.readAsDataURL(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processImage(file);
    e.target.value = "";
  }

  async function handleRemoveAvatar() {
    const ok = await silentPatch({ image: null });
    if (ok) {
      primeAvatarCache(null);
      setPreviewImage(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("avatar:updated"));
      }
      toast.success(t("settings.profileSaved"));
    }
  }

  async function silentPatch(payload: { name?: string; image?: string | null }) {
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = t("settings.profileSaveFailed");
        try { const d = await res.json(); msg = d?.error?.message ?? msg; } catch { /* non-JSON */ }
        throw new Error(msg);
      }
      await onSessionUpdate();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.profileSaveFailed"));
      return false;
    }
  }

  async function autoSaveAvatar(dataUrl: string) {
    const ok = await silentPatch({ image: dataUrl });
    if (ok) {
      primeAvatarCache(dataUrl);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("avatar:updated"));
      }
      toast.success(t("settings.profileSaved"));
    } else {
      setPreviewImage(null);
    }
  }

  async function autoSaveName() {
    const trimmed = editName.trim();
    setIsEditingName(false);
    if (!trimmed || trimmed === (user?.name ?? "")) {
      setEditName(user?.name ?? "");
      return;
    }
    const ok = await silentPatch({ name: trimmed });
    if (ok) toast.success(t("settings.profileSaved"));
  }

  return (
    <div className={s.section}>
      <div className={s.sectionStrip}>
        <span className={s.sectionStripNum}>FB-S01.A &middot; {t("settings.sectionIdentity")}</span>
        <span className={s.sectionStripRight}>
          {profileData.emailVerified ? "Verified" : "Pending"}
        </span>
      </div>
      <div className={s.sectionBody}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />

        {/* Identity row: avatar + name + chips */}
        <div className={s.identity}>
          {/* Avatar with offset shadow */}
          <div
            className={s.avatarWrap}
            onMouseEnter={() => setIsHoveringAvatar(true)}
            onMouseLeave={() => setIsHoveringAvatar(false)}
            onClick={() => fileInputRef.current?.click()}
            title={t("settings.changeAvatar")}
          >
            <div className={s.avatar}>
              {displayImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImage} alt="" />
              ) : (
                initials
              )}
            </div>
            <div
              className={s.avatarEditHint}
              style={{ opacity: isHoveringAvatar ? 1 : 0 }}
            >
              <Camera size={18} />
            </div>
          </div>

          {/* Name + email + chips */}
          <div className={s.identityInfo}>
            {isEditingName ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setIsEditingName(false); setEditName(user?.name ?? ""); }
                  if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
                }}
                onBlur={() => { autoSaveName(); }}
                maxLength={100}
                autoFocus
                className={s.identityNameEdit}
              />
            ) : (
              <div className={s.identityName} onClick={() => setIsEditingName(true)} title="Click to edit name">
                {editName || user?.name || t("settings.user")}
                <Pencil size={13} />
              </div>
            )}
            <div className={s.identityEmail}>
              {profileData.email ?? profileData.phoneNumber ?? (user?.email?.endsWith("@phone.buildflow.app") ? null : user?.email) ?? "\u2014"}
            </div>

            {/* Chips */}
            <div className={s.identityChips}>
              <span className={s.chip} data-variant="plan">
                <Shield size={10} />
                {planLabel}
              </span>
              {profileData.emailVerified && (
                <span className={s.chip} data-variant="verified">
                  <CheckCircle2 size={10} />
                  Verified
                </span>
              )}
              {profileData.createdAt && (
                <span className={s.chip}>
                  {t("settings.chipMemberSince")} {new Date(profileData.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                </span>
              )}
              {/* Remove avatar */}
              {hasImageToRemove && (
                <button
                  className={s.removeAvatar}
                  onClick={(e) => { e.stopPropagation(); handleRemoveAvatar(); }}
                >
                  <Trash2 size={10} />
                  {t("settings.removeAvatar")}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Verification rows */}
        <div className={s.verifRows}>
          <EmailVerificationRow
            email={profileData.email}
            emailVerified={profileData.emailVerified}
            onEmailAdded={(newEmail) => {
              setProfileData(prev => ({ ...prev, email: newEmail, emailVerified: false }));
              onSessionUpdate();
            }}
            onVerified={() => {
              setProfileData(prev => ({ ...prev, emailVerified: true }));
              onSessionUpdate();
            }}
          />
          <PhoneVerificationRow
            phoneNumber={profileData.phoneNumber}
            phoneVerified={profileData.phoneVerified}
            onPhoneChange={(phone) => {
              setProfileData(prev => ({
                ...prev,
                phoneNumber: phone,
                phoneVerified: false,
              }));
              onSessionUpdate();
            }}
            onVerified={() => {
              setProfileData(prev => ({ ...prev, phoneVerified: true }));
              onSessionUpdate();
            }}
          />
        </div>
      </div>
    </div>
  );
}
