// Platform admin identification — comma-separated emails in PLATFORM_ADMIN_EMAILS.
// Used to gate the live-chat admin inbox + Pusher channel auth.

// Server reads PLATFORM_ADMIN_EMAILS; client reads NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS
// (the public list is safe to expose — emails only, no secrets — and is needed
// so the Sidebar client component can conditionally render the admin nav).
const ADMIN_EMAILS: string[] = (
  process.env.PLATFORM_ADMIN_EMAILS ||
  process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS ||
  ""
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
