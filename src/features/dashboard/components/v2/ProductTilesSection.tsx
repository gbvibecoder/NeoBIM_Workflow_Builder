import { useLocale } from "@/hooks/useLocale";
import { SectionHead } from "./SectionHead";
import { ProductTile } from "./ProductTile";
import s from "./dashboard.module.css";

export function ProductTilesSection() {
  const { t } = useLocale();

  return (
    <section>
      <SectionHead
        num={t("dashboard.v2.section1Num")}
        title={
          <>
            {t("dashboard.v2.section1TitlePart1")} <em>{t("dashboard.v2.section1TitleEm1")}</em>
            {t("dashboard.v2.section1TitlePart2")} <em>{t("dashboard.v2.section1TitleEm2")}</em>.
          </>
        }
        sub={t("dashboard.v2.section1Sub")}
      />
      <div className={s.products}>
        <ProductTile tier="floor" />
        <ProductTile tier="ifc" />
        <ProductTile tier="brief" />
        <ProductTile tier="render" />
      </div>
    </section>
  );
}
