import { useLocale } from "@/hooks/useLocale";
import s from "./dashboard.module.css";

/**
 * PipelineSteps — the 5-step animated pipeline at the bottom of the hero.
 *
 * Pure CSS animations (see .heroV4Pipeline* in dashboard.module.css).
 * A glowing dot travels left → right along a dashed rail; each of the 5
 * cards pulses on a staggered timer that syncs with the dot's position.
 *
 * No props, no state, no effects — fully self-contained.
 */
export function PipelineSteps() {
  const { t } = useLocale();

  return (
    <section className={s.heroV4Pipeline}>
      <div className={s.heroV4PipelineHead}>
        <span className={s.heroV4PipelineLive}>
          {t("dashboard.v2.pipelineHead")}
        </span>
        <span>{t("dashboard.v2.pipelineFlow")}</span>
      </div>

      <div className={s.heroV4PipelineRail}>
        {/* Traveling energy packet — CSS-animated */}
        <div className={s.heroV4PipelineDot} aria-hidden="true" />

        {/* 01 · BRIEF */}
        <div className={`${s.heroV4Pcard} ${s.heroV4PcardBrief}`}>
          <span className={s.heroV4PcardNum}>01</span>
          <div className={s.heroV4PcardAnim}>
            <svg viewBox="0 0 70 50" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <line className={s.heroV4BriefLine} x1="8" y1="12" x2="58" y2="12" />
              <line className={s.heroV4BriefLine} x1="8" y1="22" x2="50" y2="22" />
              <line className={s.heroV4BriefLine} x1="8" y1="32" x2="62" y2="32" />
              <line className={s.heroV4BriefLine} x1="8" y1="42" x2="44" y2="42" />
              <polygon className={s.heroV4BriefSpark} points="60,5 62,9 66,11 62,13 60,17 58,13 54,11 58,9" />
            </svg>
          </div>
          <div className={s.heroV4PcardLabel}>{t("dashboard.v2.pipelineBrief")}</div>
          <div className={s.heroV4PcardMeta}>{t("dashboard.v2.pipelineBriefMeta")}</div>
        </div>

        {/* 02 · FLOOR PLAN */}
        <div className={`${s.heroV4Pcard} ${s.heroV4PcardFloor}`}>
          <span className={s.heroV4PcardNum}>02</span>
          <div className={s.heroV4PcardAnim}>
            <svg viewBox="0 0 70 50" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <rect className={s.heroV4FloorStroke} x="8" y="8" width="54" height="34" style={{ ['--len' as string]: '200' }} />
              <line className={s.heroV4FloorStroke} x1="8" y1="28" x2="36" y2="28" style={{ ['--len' as string]: '60' }} />
              <line className={s.heroV4FloorStroke} x1="36" y1="8" x2="36" y2="42" style={{ ['--len' as string]: '50' }} />
              <line className={s.heroV4FloorStroke} x1="36" y1="22" x2="62" y2="22" style={{ ['--len' as string]: '40' }} />
              <circle className={s.heroV4FloorRoom} cx="20" cy="18" r="1.4" />
              <circle className={s.heroV4FloorRoom} cx="22" cy="35" r="1.4" />
              <circle className={s.heroV4FloorRoom} cx="50" cy="14" r="1.4" />
            </svg>
          </div>
          <div className={s.heroV4PcardLabel}>{t("dashboard.v2.pipelineFloor")}</div>
          <div className={s.heroV4PcardMeta}>{t("dashboard.v2.pipelineFloorMeta")}</div>
        </div>

        {/* 03 · IFC */}
        <div className={`${s.heroV4Pcard} ${s.heroV4PcardIfc}`}>
          <span className={s.heroV4PcardNum}>03</span>
          <div className={s.heroV4PcardAnim}>
            <svg viewBox="0 0 70 50" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <g className={s.heroV4IfcWireframe}>
                <polygon className={s.heroV4IfcEdge} points="22,20 48,20 52,16 26,16" />
                <polygon className={s.heroV4IfcFace} points="22,20 48,20 44,28 26,28" />
                <polygon className={s.heroV4IfcEdge} points="22,20 22,38 26,42 26,28" />
                <polygon className={s.heroV4IfcEdge} points="48,20 48,38 52,34 52,16" />
                <polygon className={s.heroV4IfcFace} points="22,38 48,38 52,34 26,34" />
                <line className={s.heroV4IfcEdge} x1="22" y1="38" x2="48" y2="38" />
                <line className={s.heroV4IfcEdge} x1="22" y1="28" x2="48" y2="28" />
                <line className={s.heroV4IfcEdge} x1="22" y1="33" x2="48" y2="33" strokeDasharray="2 2" />
                <circle className={s.heroV4IfcVertex} cx="22" cy="20" r="1.4" />
                <circle className={s.heroV4IfcVertex} cx="48" cy="20" r="1.4" />
                <circle className={s.heroV4IfcVertex} cx="52" cy="16" r="1.4" />
                <circle className={s.heroV4IfcVertex} cx="26" cy="16" r="1.4" />
                <circle className={s.heroV4IfcVertex} cx="22" cy="38" r="1.4" />
                <circle className={s.heroV4IfcVertex} cx="48" cy="38" r="1.4" />
              </g>
            </svg>
          </div>
          <div className={s.heroV4PcardLabel}>{t("dashboard.v2.pipelineIfc")}</div>
          <div className={s.heroV4PcardMeta}>{t("dashboard.v2.pipelineIfcMeta")}</div>
        </div>

        {/* 04 · 3D MODEL */}
        <div className={`${s.heroV4Pcard} ${s.heroV4Pcard3d}`}>
          <span className={s.heroV4PcardNum}>04</span>
          <div className={s.heroV4PcardAnim}>
            <svg viewBox="0 0 70 50" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <defs>
                <linearGradient id="heroV4ModelSky" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F4D9A8" />
                  <stop offset="100%" stopColor="#E2A878" />
                </linearGradient>
                <radialGradient id="heroV4ModelGlow" cx="0.7" cy="0.3" r="0.5">
                  <stop offset="0%" stopColor="#FFFAE4" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#FFDCA0" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect className={s.heroV4ModelBg} x="0" y="0" width="70" height="44" />
              <rect className={s.heroV4ModelGlow} x="0" y="0" width="70" height="44" />
              <circle className={s.heroV4ModelSun} cx="52" cy="14" r="3.5" />
              <rect x="0" y="42" width="70" height="8" fill="#A88B6C" />
              <ellipse className={s.heroV4ModelShadow} cx="32" cy="44" rx="22" ry="1.5" />
              <polygon className={s.heroV4ModelMassBack} points="20,40 20,22 48,16 48,40" />
              <polygon className={s.heroV4ModelMassFront} points="20,22 48,16 44,18 24,24" />
              <polygon className={s.heroV4ModelMassTop} points="20,22 48,16 36,12 24,18" />
              <polygon className={s.heroV4ModelRoof} points="24,18 36,12 48,16 44,18 36,15 28,17" />
              <g fill="#1A2632">
                <rect x="23" y="26" width="3" height="3" />
                <rect x="28" y="26" width="3" height="3" />
                <rect x="33" y="26" width="3" height="3" />
                <rect x="38" y="26" width="3" height="3" />
                <rect x="23" y="32" width="3" height="3" />
                <rect x="28" y="32" width="3" height="3" />
                <rect x="33" y="32" width="3" height="3" />
                <rect x="38" y="32" width="3" height="3" />
              </g>
            </svg>
          </div>
          <div className={s.heroV4PcardLabel}>{t("dashboard.v2.pipeline3d")}</div>
          <div className={s.heroV4PcardMeta}>{t("dashboard.v2.pipeline3dMeta")}</div>
        </div>

        {/* 05 · BOQ */}
        <div className={`${s.heroV4Pcard} ${s.heroV4PcardBoq}`}>
          <span className={s.heroV4PcardNum}>05</span>
          <div className={s.heroV4PcardAnim}>
            <svg viewBox="0 0 70 50" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <line className={s.heroV4BoqRowLine} x1="8" y1="10" x2="40" y2="10" />
              <text className={s.heroV4BoqRowVal} x="62" y="13" textAnchor="end" fontFamily="JetBrains Mono" fontSize="6">12.4L</text>
              <line className={s.heroV4BoqRowLine} x1="8" y1="18" x2="36" y2="18" />
              <text className={s.heroV4BoqRowVal} x="62" y="21" textAnchor="end" fontFamily="JetBrains Mono" fontSize="6">8.7L</text>
              <line className={s.heroV4BoqRowLine} x1="8" y1="26" x2="38" y2="26" />
              <text className={s.heroV4BoqRowVal} x="62" y="29" textAnchor="end" fontFamily="JetBrains Mono" fontSize="6">15.2L</text>
              <line className={s.heroV4BoqRowLine} x1="8" y1="34" x2="34" y2="34" />
              <text className={s.heroV4BoqRowVal} x="62" y="37" textAnchor="end" fontFamily="JetBrains Mono" fontSize="6">6.1L</text>
              <line className={s.heroV4BoqTotalBar} x1="8" y1="40" x2="62" y2="40" />
              <text className={s.heroV4BoqTotal} x="8" y="48">TOTAL</text>
              <text className={s.heroV4BoqTotal} x="62" y="48" textAnchor="end">₹1.84 Cr</text>
            </svg>
          </div>
          <div className={s.heroV4PcardLabel}>{t("dashboard.v2.pipelineBoq")}</div>
          <div className={s.heroV4PcardMeta}>{t("dashboard.v2.pipelineBoqMeta")}</div>
        </div>
      </div>
    </section>
  );
}
