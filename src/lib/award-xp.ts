import { toast } from "sonner";

interface XPResponse {
  awarded: boolean;
  xpAwarded?: number;
  xp: number;
  level: number;
  progress: number;
  leveledUp: boolean;
  newLevel?: number;
}

/**
 * Award XP for an action. Shows level-up toast if applicable.
 * Fire-and-forget — never throws.
 */
export async function awardXP(action: string): Promise<XPResponse | null> {
  try {
    const res = await fetch("/api/user/xp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as XPResponse;

    if (data.leveledUp && data.newLevel) {
      toast.success(`Level Up! You're now Level ${data.newLevel}`, {
        description: `+${data.xpAwarded ?? 0} XP earned`,
        duration: 6000,
      });
    } else if (data.awarded && data.xpAwarded) {
      toast.success(`+${data.xpAwarded} XP`, { duration: 2000 });
    }

    return data;
  } catch {
    return null;
  }
}
