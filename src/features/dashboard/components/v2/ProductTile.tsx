import Link from "next/link";
import { Layers, Building2, FileText, Palette, ArrowRight } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ProductPreviewFloor } from "./ProductPreviewFloor";
import { ProductPreviewIfc } from "./ProductPreviewIfc";
import { ProductPreviewBrief } from "./ProductPreviewBrief";
import { ProductPreviewRender } from "./ProductPreviewRender";
import s from "./dashboard.module.css";
import type { TranslationKey } from "@/lib/i18n";

type Tier = "floor" | "ifc" | "brief" | "render";

const CONFIG: Record<Tier, {
  num: string;
  nameKey: TranslationKey;
  nameEmKey: TranslationKey;
  taglineKey: TranslationKey;
  descKey: TranslationKey;
  ctaKey: TranslationKey;
  href: string;
  icon: typeof Layers;
  preview: () => React.JSX.Element;
}> = {
  floor: {
    num: "FB-P01", nameKey: "dashboard.v2.productFloorName", nameEmKey: "dashboard.v2.productFloorNameEm",
    taglineKey: "dashboard.v2.productFloorTagline", descKey: "dashboard.v2.productFloorDesc",
    ctaKey: "dashboard.v2.productFloorCta", href: "/dashboard/floor-plan",
    icon: Layers, preview: ProductPreviewFloor,
  },
  ifc: {
    num: "FB-P02", nameKey: "dashboard.v2.productIfcName", nameEmKey: "dashboard.v2.productIfcNameEm",
    taglineKey: "dashboard.v2.productIfcTagline", descKey: "dashboard.v2.productIfcDesc",
    ctaKey: "dashboard.v2.productIfcCta", href: "/dashboard/ifc-viewer",
    icon: Building2, preview: ProductPreviewIfc,
  },
  brief: {
    num: "FB-P03", nameKey: "dashboard.v2.productBriefName", nameEmKey: "dashboard.v2.productBriefNameEm",
    taglineKey: "dashboard.v2.productBriefTagline", descKey: "dashboard.v2.productBriefDesc",
    ctaKey: "dashboard.v2.productBriefCta", href: "/dashboard/brief-renders",
    icon: FileText, preview: ProductPreviewBrief,
  },
  render: {
    num: "FB-P04", nameKey: "dashboard.v2.productRenderName", nameEmKey: "dashboard.v2.productRenderNameEm",
    taglineKey: "dashboard.v2.productRenderTagline", descKey: "dashboard.v2.productRenderDesc",
    ctaKey: "dashboard.v2.productRenderCta", href: "/dashboard/3d-render",
    icon: Palette, preview: ProductPreviewRender,
  },
};

interface ProductTileProps {
  tier: Tier;
}

export function ProductTile({ tier }: ProductTileProps) {
  const { t } = useLocale();
  const cfg = CONFIG[tier];
  const Icon = cfg.icon;
  const Preview = cfg.preview;

  return (
    <Link href={cfg.href} className={s.product} data-tier={tier}>
      <div className={s.productStrip}>
        <span className={s.productStripNum}>{cfg.num}</span>
        <span className={s.productStripTick}>✓</span>
      </div>
      <div className={s.productPreview}>
        <Preview />
      </div>
      <div className={s.productBody}>
        <div className={s.productIcon}>
          <Icon size={18} />
        </div>
        <div className={s.productName}>
          {t(cfg.nameKey)}<em className={s.productNameEm}>{t(cfg.nameEmKey)}</em>
        </div>
        <div className={s.productTagline}>{t(cfg.taglineKey)}</div>
        <div className={s.productDesc}>{t(cfg.descKey)}</div>
        <div className={s.productCta}>
          {t(cfg.ctaKey)} <ArrowRight size={13} />
        </div>
      </div>
    </Link>
  );
}
