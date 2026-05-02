"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { IdentityCard } from "./IdentityCard";
import { AccountDetailsCard } from "./AccountDetailsCard";
import { InviteEarnCard } from "./InviteEarnCard";

export function ProfileTab() {
  const { data: session, update: updateSession } = useSession();
  const user = session?.user;
  const initials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : (user?.email?.[0] ?? "U").toUpperCase();

  const [profileData, setProfileData] = useState<{
    email: string | null;
    emailVerified: boolean;
    phoneNumber: string | null;
    phoneVerified: boolean;
    createdAt: string | null;
    role: string;
  }>({ email: null, emailVerified: false, phoneNumber: null, phoneVerified: false, createdAt: null, role: "FREE" });

  // Fetch profile data (emailVerified, createdAt, role)
  useEffect(() => {
    fetch("/api/user/profile")
      .then(res => res.json())
      .then(data => {
        if (data.emailVerified !== undefined) {
          setProfileData({
            email: data.email ?? null,
            emailVerified: data.emailVerified,
            phoneNumber: data.phoneNumber ?? null,
            phoneVerified: !!data.phoneVerified,
            createdAt: data.createdAt,
            role: data.role,
          });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <IdentityCard
        user={user}
        initials={initials}
        profileData={profileData}
        setProfileData={setProfileData}
        onSessionUpdate={updateSession}
      />
      <AccountDetailsCard profileData={profileData} user={user} />
      <InviteEarnCard />
    </div>
  );
}
