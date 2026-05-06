import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import s from "./dashboard.module.css";

interface SectionHeadProps {
  num: string;
  title: ReactNode;
  sub?: string;
  link?: { label: string; href: string };
}

export function SectionHead({ num, title, sub, link }: SectionHeadProps) {
  return (
    <>
      <div className={s.sectionHeadStrip}>
        <span className={s.sectionHeadNum}>{num}</span>
      </div>
      <div className={s.sectionHead}>
        <div className={s.sectionHeadText}>
          <h2 className={s.sectionHeadTitle}>{title}</h2>
          {sub && <p className={s.sectionHeadSub}>{sub}</p>}
        </div>
        {link && (
          <Link href={link.href} className={s.sectionHeadLink}>
            {link.label} <ArrowRight size={13} />
          </Link>
        )}
      </div>
    </>
  );
}
