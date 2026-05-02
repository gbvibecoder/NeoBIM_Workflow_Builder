/**
 * CompleteHero — editorial completion state with PDF carousel + stats.
 *
 * Renders the "Your N-page editorial PDF is ready" hero block when a
 * Brief-to-Renders job reaches COMPLETED. Includes a 3-page carousel
 * preview (cover + 2 hero shots), summary statistics, cost breakdown,
 * and the primary "Get the PDF" download CTA.
 */

"use client";

import { useMemo, useState } from "react";

import s from "@/app/dashboard/brief-renders/page.module.css";
import { PdfDownloadButton } from "@/features/brief-renders/components/PdfDownloadButton";
import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";
import type {
  BriefSpec,
  BriefStageLogEntry,
  ShotResult,
  ShotSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";

export interface CompleteHeroProps {
  job: BriefRenderJobView;
  onStartNew: () => void;
}

interface HeroShotInfo {
  imageUrl: string | null;
  apartmentLabel: string;
  roomNameEn: string;
  roomNameDe: string;
  materialNotes: string;
  prompt: string;
}

function countHeroShots(spec: BriefSpec | null): number {
  if (!spec?.apartments) return 0;
  return spec.apartments
    .flatMap((a) => a.shots)
    .filter((sh) => sh.isHero).length;
}

function pickHeroShots(
  spec: BriefSpec | null,
  shots: ShotResult[],
  count: number,
): HeroShotInfo[] {
  if (!spec || shots.length === 0) return [];
  const heroes: HeroShotInfo[] = [];
  for (const shot of shots) {
    const apt = spec.apartments[shot.apartmentIndex ?? 0] ?? null;
    const shotSpec: ShotSpec | null =
      apt?.shots[shot.shotIndexInApartment] ?? null;
    if (shotSpec?.isHero && shot.status === "success" && shot.imageUrl) {
      heroes.push({
        imageUrl: shot.imageUrl,
        apartmentLabel: apt?.label ?? "—",
        roomNameEn: shotSpec?.roomNameEn ?? "Shot",
        roomNameDe: shotSpec?.roomNameDe ?? "",
        materialNotes: shotSpec?.materialNotes ?? "",
        prompt: shot.prompt,
      });
      if (heroes.length >= count) break;
    }
  }
  // Fallback: fill from non-hero successful shots
  if (heroes.length < count) {
    for (const shot of shots) {
      if (shot.status === "success" && shot.imageUrl && !heroes.some((h) => h.imageUrl === shot.imageUrl)) {
        const apt = spec.apartments[shot.apartmentIndex ?? 0] ?? null;
        const shotSpec: ShotSpec | null =
          apt?.shots[shot.shotIndexInApartment] ?? null;
        heroes.push({
          imageUrl: shot.imageUrl,
          apartmentLabel: apt?.label ?? "—",
          roomNameEn: shotSpec?.roomNameEn ?? "Shot",
          roomNameDe: shotSpec?.roomNameDe ?? "",
          materialNotes: shotSpec?.materialNotes ?? "",
          prompt: shot.prompt,
        });
        if (heroes.length >= count) break;
      }
    }
  }
  return heroes;
}

function PdfHeroPage({ shot }: { shot: HeroShotInfo }) {
  return (
    <div className={s.pdfPage}>
      <div className={s.pdfPageHead}>
        <span>Confidential — for client review</span>
        <span className={s.pdfPageHeadBurnt}>Hero shot</span>
      </div>
      <div className={s.pdfPageApt}>{shot.apartmentLabel}</div>
      <div className={s.pdfPageMeta}>
        <span />
        <span className={s.pdfPageHero}>
          <span className={s.pdfPageHeroMark} />
          Hero shot
        </span>
      </div>
      <div className={s.pdfPageRoom}>{shot.roomNameEn}</div>
      {shot.roomNameDe && (
        <div className={s.pdfPageRoomDe}>{shot.roomNameDe}</div>
      )}
      <div className={s.pdfPageNotesLabel}>Visual notes</div>
      <div className={s.pdfPageNotes}>
        {(shot.materialNotes || shot.prompt || "").slice(0, 280)}…
      </div>
      {shot.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shot.imageUrl}
          alt={shot.roomNameEn}
          className={s.pdfPageImg}
        />
      ) : (
        <div className={s.pdfPageImg} />
      )}
    </div>
  );
}

export function CompleteHero({ job, onStartNew }: CompleteHeroProps) {
  const spec = job.specResult as BriefSpec | null;
  const shots = (job.shots as ShotResult[] | null) ?? [];
  const totalShots = shots.length || 12;
  const heroCount = countHeroShots(spec);
  const totalPages = totalShots + 1;
  const heroShots = useMemo(() => pickHeroShots(spec, shots, 2), [spec, shots]);
  const [currentPage, setCurrentPage] = useState(0);
  const maxPage = Math.min(2, heroShots.length);

  // Set of 0-based flat shot indices that are hero shots (for page strip rendering)
  const heroShotIndices = useMemo(() => {
    const set = new Set<number>();
    if (!spec?.apartments) return set;
    let flatIdx = 0;
    for (const apt of spec.apartments) {
      for (const sh of apt.shots) {
        if (sh.isHero) set.add(flatIdx);
        flatIdx++;
      }
    }
    return set;
  }, [spec]);

  // Map carousel pages (0/1/2) → actual page-strip page numbers
  const heroPageNumbers = useMemo(() => {
    return [...heroShotIndices].slice(0, 2).map((idx) => idx + 1);
  }, [heroShotIndices]);

  const costBreakdown = useMemo(() => {
    const log = Array.isArray(job.stageLog)
      ? (job.stageLog as BriefStageLogEntry[])
      : [];
    const stages = { spec: 0, prompt: 0, images: 0, pdf: 0 };
    for (const entry of log) {
      const cost = entry.costUsd ?? 0;
      if (entry.stage === 1) stages.spec += cost;
      else if (entry.stage === 2) stages.prompt += cost;
      else if (entry.stage >= 3 && entry.name?.toLowerCase().includes("image"))
        stages.images += cost;
      else if (entry.stage >= 3 && entry.name?.toLowerCase().includes("spec"))
        stages.spec += cost;
      else if (entry.stage === 4) stages.pdf += cost;
      else stages.images += cost;
    }
    return stages;
  }, [job.stageLog]);

  return (
    <div className={s.completeHero}>
      <div className={s.completeHeroInner}>
        {/* Left: stats + actions */}
        <div>
          <span className={s.completeEyebrow}>
            <span className={s.completeEyebrowDot} />
            Step 4 of 4 · Complete
          </span>
          <h2 className={s.completeTitle}>
            Your{" "}
            <em className={s.completeTitleEm}>
              {totalPages}-page editorial PDF
            </em>{" "}
            is ready.
          </h2>
          <p
            style={{
              marginTop: 14,
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--rs-text)",
              maxWidth: "40ch",
            }}
          >
            Cover sheet, {totalShots} shot pages — each with photoreal render,
            visual notes, room area, and lighting spec. Print-ready 300 DPI.
          </p>

          <div className={s.completeStats}>
            <div>
              <div className={s.completeStatNum}>
                <em className={s.completeStatNumEm}>
                  {String(totalPages).padStart(2, "0")}
                </em>
              </div>
              <div className={s.completeStatLabel}>Pages</div>
            </div>
            <div>
              <div className={s.completeStatNum}>
                <em className={s.completeStatNumEm}>
                  {String(totalShots).padStart(2, "0")}
                </em>
              </div>
              <div className={s.completeStatLabel}>Renders</div>
            </div>
            <div>
              <div className={s.completeStatNum}>
                <em className={s.completeStatNumEm}>
                  {String(heroCount).padStart(2, "0")}
                </em>
              </div>
              <div className={s.completeStatLabel}>Hero shots</div>
            </div>
          </div>

          {/* Cost breakdown */}
          <div className={s.costBreakdown}>
            <div className={s.costBreakdownEyebrow}>Cost breakdown</div>
            <div className={s.costBreakdownGrid}>
              <div className={s.costBreakdownItem}>
                <div className={s.costBreakdownLabel}>Spec extract</div>
                <div className={s.costBreakdownValue}>
                  ${costBreakdown.spec.toFixed(3)}
                </div>
              </div>
              <div className={s.costBreakdownItem}>
                <div className={s.costBreakdownLabel}>Prompt gen</div>
                <div className={s.costBreakdownValue}>
                  ${costBreakdown.prompt.toFixed(3)}
                </div>
              </div>
              <div className={s.costBreakdownItem}>
                <div className={s.costBreakdownLabel}>
                  {totalShots} renders
                </div>
                <div className={s.costBreakdownValue}>
                  ${costBreakdown.images.toFixed(3)}
                </div>
              </div>
              <div
                className={`${s.costBreakdownItem} ${s.costBreakdownTotal}`}
              >
                <div className={s.costBreakdownLabel}>Total</div>
                <div className={s.costBreakdownValue}>
                  ${job.costUsd.toFixed(3)}
                </div>
              </div>
            </div>
          </div>

          <div className={s.completeActions}>
            <PdfDownloadButton pdfUrl={job.pdfUrl} />
            <button
              type="button"
              onClick={onStartNew}
              className={s.btnSecondary}
            >
              Start a new brief
            </button>
          </div>
        </div>

        {/* Right: 3-page PDF carousel */}
        <div className={s.pdfCarousel}>
          <div className={`${s.pdfFrame} ${s.pdfFrameStack}`}>
            <div className={s.pdfFrameInner}>
              {/* Page 0: Cover */}
              {currentPage === 0 && (
                <div className={`${s.pdfPage} ${s.pdfPageCover}`}>
                  <div className={s.pdfCoverInner}>
                    <div className={s.pdfCoverEyebrow}>
                      Confidential — for client review
                    </div>
                    <div className={s.pdfCoverDivider} />
                    <h3 className={s.pdfCoverTitle}>
                      {spec?.projectTitle ?? "Your project"}
                    </h3>
                    <div className={s.pdfCoverLocation}>
                      {spec?.projectLocation ?? ""}
                    </div>
                    <div className={s.pdfCoverStats}>
                      <div>
                        <div className={s.pdfCoverStatNum}>{totalShots}</div>
                        <div className={s.pdfCoverStatLabel}>
                          Photoreal interiors
                        </div>
                      </div>
                      <div className={s.pdfCoverDivider} />
                      <div>
                        <div className={s.pdfCoverStatNum}>
                          {spec?.apartments?.length ?? 0}
                        </div>
                        <div className={s.pdfCoverStatLabel}>Apartments</div>
                      </div>
                    </div>
                    <div className={s.pdfCoverFoot}>
                      v01 — {spec?.projectType ?? "Draft"}
                    </div>
                  </div>
                </div>
              )}

              {/* Page 1: First hero shot */}
              {currentPage === 1 && heroShots[0] && (
                <PdfHeroPage shot={heroShots[0]} />
              )}

              {/* Page 2: Second hero shot */}
              {currentPage === 2 && heroShots[1] && (
                <PdfHeroPage shot={heroShots[1]} />
              )}

              {/* Carousel arrows */}
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className={`${s.pdfArrow} ${s.pdfArrowLeft}`}
                aria-label="Previous page"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() =>
                  setCurrentPage((p) => Math.min(maxPage, p + 1))
                }
                disabled={currentPage >= maxPage}
                className={`${s.pdfArrow} ${s.pdfArrowRight}`}
                aria-label="Next page"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>

          {/* Carousel dots */}
          <div className={s.pdfDots}>
            {Array.from({ length: maxPage + 1 }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentPage(i)}
                className={s.pdfDot}
                data-active={currentPage === i ? "true" : undefined}
                aria-label={`Page ${i + 1}`}
              />
            ))}
          </div>

          {/* Full PDF link */}
          {job.pdfUrl && (
            <a
              href={job.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={s.pdfFullLink}
            >
              Open full {totalPages}-page PDF in new tab
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
      </div>

      {/* Page strip — abstracted page previews */}
      <div className={s.pdfPagesStrip}>
        {Array.from({ length: totalPages }, (_, i) => {
          const isCover = i === 0;
          const shotFlatIdx = i - 1;
          const isHeroPage = !isCover && heroShotIndices.has(shotFlatIdx);

          // Map which carousel page this strip thumb corresponds to
          const carouselMap = [0, heroPageNumbers[0] ?? 1, heroPageNumbers[1] ?? 2];
          const isCurrent = carouselMap[currentPage] === i;

          const handleThumbClick = () => {
            if (isCover) setCurrentPage(0);
            else if (heroPageNumbers[0] === i) setCurrentPage(1);
            else if (heroPageNumbers[1] === i) setCurrentPage(2);
          };

          return (
            <button
              key={i}
              type="button"
              onClick={handleThumbClick}
              className={s.pdfPageThumb}
              data-current={isCurrent ? "true" : undefined}
              aria-label={`Page ${i + 1}${isCover ? " (cover)" : isHeroPage ? " (hero)" : ""}`}
            >
              {isCover && (
                <div className={s.pdfPageThumbCover}>
                  <div className={s.pdfPageThumbCoverLine} />
                  <div className={s.pdfPageThumbCoverDivider} />
                  <div className={s.pdfPageThumbCoverLine} style={{ width: "70%" }} />
                  <div className={s.pdfPageThumbCoverLine} style={{ width: "50%" }} />
                </div>
              )}
              {isHeroPage && (
                <div className={s.pdfPageThumbHero}>
                  <div className={s.pdfPageThumbHeroStripe} />
                  <div className={s.pdfPageThumbHeroImg} />
                  <div className={s.pdfPageThumbHeroLine} />
                </div>
              )}
              {!isCover && !isHeroPage && (
                <div className={s.pdfPageThumbStandard}>
                  <div className={s.pdfPageThumbStandardImg} />
                  <div className={s.pdfPageThumbStandardLine} />
                </div>
              )}
              <div className={s.pdfPageThumbNum}>{i + 1}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
