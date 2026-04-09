import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import AdminLiveChatLayout from "@/features/support/components/AdminLiveChatLayout";

export const dynamic = "force-dynamic";

export default async function AdminLiveChatPage() {
  const session = await auth();
  if (!session?.user?.email || !isPlatformAdmin(session.user.email)) {
    redirect("/dashboard");
  }
  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex" }}>
      <AdminLiveChatLayout />
    </div>
  );
}
