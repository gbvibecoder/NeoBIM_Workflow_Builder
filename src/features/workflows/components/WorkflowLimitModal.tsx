import { Zap, ArrowRight } from "lucide-react";
import { STRIPE_PLANS } from "@/features/billing/lib/stripe";
import s from "./page.module.css";

interface Props {
  currentCount: number;
  userRole: string | undefined;
  onUpgrade: () => void;
  onDismiss: () => void;
}

const PERKS = [
  { icon: "\u267E\uFE0F", text: "Unlimited workflows (Pro)" },
  { icon: "\u26A1", text: "Up to 100 runs per month" },
  { icon: "\u{1F3AC}", text: "AI video walkthroughs" },
  { icon: "\u{1F9CA}", text: "3D model generation" },
];

export function WorkflowLimitModal({ currentCount, userRole, onUpgrade, onDismiss }: Props) {
  const role = userRole ?? "FREE";
  const planLimits =
    role === "STARTER" ? STRIPE_PLANS.STARTER.limits
    : role === "MINI" ? STRIPE_PLANS.MINI.limits
    : STRIPE_PLANS.FREE.limits;
  const max = planLimits.maxWorkflows;
  const planName = role === "STARTER" ? "Starter" : role === "MINI" ? "Mini" : "Free";

  return (
    <div className={s.modalOverlay} onClick={onDismiss}>
      <div className={s.modalPanel} onClick={e => e.stopPropagation()}>
        <div className={s.modalAccent} style={{ background: "linear-gradient(90deg, var(--rs-blueprint), var(--rs-burnt), var(--rs-blueprint))" }} />
        <div className={s.modalBody} style={{ paddingBottom: 0, paddingTop: 36 }}>
          <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 10 }}>{"\u{1F419}"}</div>
          <h2 className={s.modalTitle}>
            {max} workflows? That&apos;s adorable!
          </h2>
          <p className={s.modalDesc}>
            You&apos;ve filled up your {max} workflow slots on the{" "}
            <strong style={{ color: "var(--rs-blueprint)" }}>{planName}</strong> plan.
            Time to level up and build without limits.
          </p>
        </div>
        <div className={s.modalFooter}>
          <div className={s.upgradePerks}>
            <div className={s.upgradePerksTitle}>Upgrade perks</div>
            {PERKS.map((p, i) => (
              <div key={i} className={s.upgradePerkRow}>
                <span className={s.upgradePerkIcon}>{p.icon}</span>
                <span className={s.upgradePerkText}>{p.text}</span>
              </div>
            ))}
          </div>
          <button className={s.modalBtnUpgrade} onClick={onUpgrade}>
            <Zap size={18} /> Upgrade &amp; Build Unlimited <ArrowRight size={16} />
          </button>
          <button className={s.modalDismiss} onClick={onDismiss}>
            I&apos;ll manage with {max} for now
          </button>
        </div>
      </div>
    </div>
  );
}
