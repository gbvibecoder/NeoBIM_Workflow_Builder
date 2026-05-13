/**
 * Z.CANVAS.RUNTIME-THEME — JavaScript token constants for canvas theming.
 *
 * CSS custom property inheritance via var(--canvas-*) in inline styles does NOT
 * work reliably through the Tailwind v4 + Lightning CSS + Next.js 16 build
 * pipeline. This module provides runtime-resolved values instead.
 *
 * Usage:
 *   const t = useCanvasToken();
 *   <div style={{ background: t.surface1, color: t.text1 }} />
 *
 * SINGLE SOURCE OF TRUTH: values extracted verbatim from canvas-theme.css
 * .canvas-theme-light and .canvas-theme-dark scopes.
 */

import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";

// ─── Token pairs: { light, dark } ──────────────────────────────────────────

const T = {
  // ── Base surfaces ─────────────────────────────────────────────
  bg:              { l: "#FAF7F2",                                    d: "#0E0E10" },
  bgDim:           { l: "#F2EEE7",                                    d: "#0A0A0D" },
  surface1:        { l: "#FFFFFF",                                    d: "rgba(10, 12, 16, 0.88)" },
  surface2:        { l: "#FBFAF7",                                    d: "rgba(7, 8, 9, 0.92)" },

  // ── Text ──────────────────────────────────────────────────────
  text1:           { l: "#0F1419",                                    d: "#F0F0F5" },
  text2:           { l: "#4A5360",                                    d: "#9898B0" },
  text3:           { l: "#8089A0",                                    d: "#6B6B80" },
  text4:           { l: "#BCC2CE",                                    d: "#3A3A50" },

  // ── Lines / borders ───────────────────────────────────────────
  line1:           { l: "rgba(15, 20, 25, 0.06)",                     d: "rgba(255, 255, 255, 0.06)" },
  line2:           { l: "rgba(15, 20, 25, 0.10)",                     d: "rgba(255, 255, 255, 0.10)" },
  line3:           { l: "rgba(15, 20, 25, 0.16)",                     d: "rgba(255, 255, 255, 0.15)" },
  lineFocus:       { l: "rgba(37, 99, 235, 0.45)",                    d: "rgba(0, 245, 255, 0.5)" },

  // ── Category colors ───────────────────────────────────────────
  catInput:        { l: "#1E40AF",                                    d: "#00F5FF" },
  catInputSoft:    { l: "#DBE5FF",                                    d: "rgba(0, 245, 255, 0.12)" },
  catTransform:    { l: "#7C3AED",                                    d: "#B87333" },
  catTransformSoft:{ l: "#ECE0FE",                                    d: "rgba(184, 115, 51, 0.12)" },
  catGenerate:     { l: "#15803D",                                    d: "#FFBF00" },
  catGenerateSoft: { l: "#D5F0DE",                                    d: "rgba(255, 191, 0, 0.12)" },
  catExport:       { l: "#EA580C",                                    d: "#4FC3F7" },
  catExportSoft:   { l: "#FEE2CD",                                    d: "rgba(79, 195, 247, 0.12)" },

  // ── Status ────────────────────────────────────────────────────
  statusRunning:   { l: "#2563EB",                                    d: "#FFBF00" },
  statusSuccess:   { l: "#059669",                                    d: "#10B981" },
  statusError:     { l: "#DC2626",                                    d: "#EF4444" },
  statusWarning:   { l: "#D97706",                                    d: "#F59E0B" },

  // ── Edges ─────────────────────────────────────────────────────
  edgeDefault:     { l: "#94A3B8",                                    d: "#B87333" },
  edgeActive:      { l: "#2563EB",                                    d: "#00F5FF" },
  edgeSuccess:     { l: "#059669",                                    d: "#10B981" },
  edgeError:       { l: "#DC2626",                                    d: "#EF4444" },
  edgeFallback:    { l: "#94A3B8",                                    d: "#B87333" },

  // ── Shadows ───────────────────────────────────────────────────
  shadowSm:        { l: "0 1px 2px rgba(15,20,25,0.04), 0 1px 4px rgba(15,20,25,0.04)",
                     d: "0 1px 2px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)" },
  shadowMd:        { l: "0 2px 4px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.06)",
                     d: "0 4px 24px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.03) inset" },
  shadowLg:        { l: "0 4px 8px rgba(15,20,25,0.04), 0 12px 32px rgba(15,20,25,0.08)",
                     d: "0 16px 48px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.04) inset" },

  // ── Hover states ──────────────────────────────────────────────
  hoverBg:         { l: "rgba(15, 20, 25, 0.04)",                     d: "rgba(255, 255, 255, 0.06)" },
  hoverBgStrong:   { l: "rgba(15, 20, 25, 0.06)",                     d: "rgba(255, 255, 255, 0.08)" },

  // ── Accent ────────────────────────────────────────────────────
  accent:          { l: "#2563EB",                                    d: "#00F5FF" },
  accentBg:        { l: "rgba(37, 99, 235, 0.08)",                    d: "rgba(0, 245, 255, 0.08)" },
  accentBgHover:   { l: "rgba(37, 99, 235, 0.14)",                    d: "rgba(0, 245, 255, 0.15)" },
  accentBgActive:  { l: "rgba(37, 99, 235, 0.10)",                    d: "rgba(0, 245, 255, 0.10)" },
  accentBorder:    { l: "rgba(37, 99, 235, 0.25)",                    d: "rgba(0, 245, 255, 0.25)" },
  accentBorderStrong: { l: "rgba(37, 99, 235, 0.35)",                 d: "rgba(0, 245, 255, 0.3)" },

  // ── Run button ────────────────────────────────────────────────
  runBg:           { l: "linear-gradient(180deg, #059669, #047857)",   d: "rgba(0, 245, 255, 0.08)" },
  runBgHover:      { l: "linear-gradient(180deg, #047857, #065F46)",   d: "rgba(0, 245, 255, 0.15)" },
  runBorder:       { l: "transparent",                                 d: "rgba(0, 245, 255, 0.3)" },
  runBorderSplit:  { l: "rgba(255, 255, 255, 0.18)",                   d: "rgba(0, 245, 255, 0.15)" },
  runText:         { l: "#FFFFFF",                                     d: "#00F5FF" },

  // ── Stop button ───────────────────────────────────────────────
  stopBg:          { l: "rgba(220, 38, 38, 0.08)",                     d: "rgba(239, 68, 68, 0.12)" },
  stopBgHover:     { l: "rgba(220, 38, 38, 0.14)",                     d: "rgba(239, 68, 68, 0.20)" },
  stopBorder:      { l: "rgba(220, 38, 38, 0.30)",                     d: "rgba(239, 68, 68, 0.35)" },
  stopText:        { l: "#DC2626",                                     d: "#EF4444" },

  // ── AI button ─────────────────────────────────────────────────
  aiBg:            { l: "rgba(124, 58, 237, 0.08)",                    d: "rgba(0, 245, 255, 0.06)" },
  aiBgHover:       { l: "rgba(124, 58, 237, 0.14)",                    d: "rgba(0, 245, 255, 0.12)" },
  aiBorder:        { l: "rgba(124, 58, 237, 0.20)",                    d: "rgba(0, 245, 255, 0.15)" },
  aiBorderHover:   { l: "rgba(124, 58, 237, 0.35)",                    d: "rgba(0, 245, 255, 0.3)" },
  aiText:          { l: "#7C3AED",                                     d: "#00F5FF" },

  // ── Save flash ────────────────────────────────────────────────
  saveFlashBg:     { l: "rgba(5, 150, 105, 0.08)",                     d: "rgba(16, 185, 129, 0.10)" },
  saveFlashBorder: { l: "rgba(5, 150, 105, 0.25)",                     d: "rgba(16, 185, 129, 0.3)" },
  saveFlashText:   { l: "#059669",                                     d: "#34D399" },

  // ── Dropdowns ─────────────────────────────────────────────────
  dropdownBg:      { l: "#FFFFFF",                                     d: "rgba(12, 13, 16, 0.98)" },
  dropdownBorder:  { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.08)" },
  dropdownShadow:  { l: "0 4px 16px rgba(15,20,25,0.10), 0 1px 3px rgba(15,20,25,0.06)",
                     d: "0 12px 40px rgba(0,0,0,0.5)" },

  // ── Dirty dot + name focus ────────────────────────────────────
  dirtyDot:        { l: "#D97706",                                     d: "#FFBF00" },
  nameFocusBorder: { l: "rgba(37, 99, 235, 0.45)",                     d: "rgba(0, 245, 255, 0.4)" },

  // ── Panels ────────────────────────────────────────────────────
  panelBg:         { l: "#FFFFFF",                                     d: "rgba(10, 12, 16, 0.92)" },
  panelBorder:     { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.06)" },
  panelShadow:     { l: "0 2px 4px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.06)",
                     d: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03) inset" },

  // ── Library ───────────────────────────────────────────────────
  libSearchBg:     { l: "#FBFAF7",                                     d: "rgba(255, 255, 255, 0.04)" },
  libSearchFocus:  { l: "rgba(37, 99, 235, 0.10)",                     d: "rgba(0, 245, 255, 0.15)" },
  libRowHover:     { l: "#FBFAF7",                                     d: "rgba(255, 255, 255, 0.06)" },
  libTabActive:    { l: "#0F1419",                                     d: "#F0F0F5" },
  libTabIdle:      { l: "#8089A0",                                     d: "rgba(255, 255, 255, 0.5)" },
  libTabBorder:    { l: "#2563EB",                                     d: "rgba(0, 245, 255, 0.5)" },

  // ── Library badges ────────────────────────────────────────────
  badgeLiveBg:     { l: "rgba(5, 150, 105, 0.10)",                     d: "rgba(16, 185, 129, 0.12)" },
  badgeLiveText:   { l: "#059669",                                     d: "#10B981" },
  badgeDemoBg:     { l: "#FEF3C7",                                     d: "rgba(251, 191, 36, 0.15)" },
  badgeDemoText:   { l: "#92400E",                                     d: "#FBBF24" },
  badgeVipBg:      { l: "rgba(124, 58, 237, 0.10)",                    d: "rgba(124, 58, 237, 0.12)" },
  badgeVipText:    { l: "#7C3AED",                                     d: "#A855F7" },

  // ── AI Panel ──────────────────────────────────────────────────
  aiPanelBg:       { l: "linear-gradient(135deg, #FFFFFF, #FAF5FF)",    d: "rgba(7, 8, 9, 0.92)" },
  aiPanelBorder:   { l: "rgba(124, 58, 237, 0.20)",                    d: "rgba(0, 245, 255, 0.2)" },
  aiPanelGlow:     { l: "0 2px 8px rgba(15,20,25,0.06), 0 0 0 4px rgba(124,58,237,0.04)",
                     d: "0 4px 20px rgba(0,0,0,0.4), 0 0 15px rgba(0,245,255,0.08)" },
  aiInputBg:       { l: "#FBFAF7",                                     d: "rgba(255, 255, 255, 0.03)" },
  aiInputBorder:   { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.06)" },
  aiSendActive:    { l: "#7C3AED",                                     d: "#00F5FF" },

  // ── Notebook (Field Notes) ────────────────────────────────────
  notebookBg:      { l: "#F4EFE2",                                     d: "rgba(5, 5, 8, 0.92)" },
  notebookRule:    { l: "rgba(45, 52, 60, 0.08)",                      d: "transparent" },
  notebookMargin:  { l: "rgba(178, 58, 72, 0.40)",                     d: "transparent" },
  logTimestamp:    { l: "#8089A0",                                     d: "#2a2a3a" },
  logMuted:        { l: "#4A5360",                                     d: "#5C5C78" },
  logBadgeBg:      { l: "rgba(15, 20, 25, 0.05)",                      d: "rgba(255, 255, 255, 0.04)" },
  logBadgeText:    { l: "#8089A0",                                     d: "#3A3A50" },
  logMsgError:     { l: "#DC2626",                                     d: "#F87171" },
  logMsgSuccess:   { l: "#059669",                                     d: "#34D399" },

  // ── Library inner ─────────────────────────────────────────────
  libActiveBg:     { l: "rgba(37, 99, 235, 0.06)",                     d: "rgba(0, 245, 255, 0.06)" },
  libActiveBorder: { l: "rgba(37, 99, 235, 0.14)",                     d: "rgba(0, 245, 255, 0.14)" },
  libActiveText:   { l: "#2563EB",                                     d: "#00F5FF" },
  libTextPrimary:  { l: "#0F1419",                                     d: "#E2E8F0" },
  libTextSecondary:{ l: "#4A5360",                                     d: "rgba(255, 255, 255, 0.45)" },
  libTextMeta:     { l: "#8089A0",                                     d: "rgba(255, 255, 255, 0.25)" },
  libTextDim:      { l: "#BCC2CE",                                     d: "rgba(255, 255, 255, 0.2)" },
  libTextHint:     { l: "#BCC2CE",                                     d: "rgba(255, 255, 255, 0.15)" },
  libIconMuted:    { l: "#8089A0",                                     d: "rgba(255, 255, 255, 0.35)" },
  libIconChevron:  { l: "#8089A0",                                     d: "rgba(255, 255, 255, 0.3)" },
  libSearchBorder: { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.08)" },
  libSearchText:   { l: "#0F1419",                                     d: "#E2E8F0" },
  libFilterActiveBg:     { l: "rgba(37, 99, 235, 0.08)",               d: "rgba(0, 245, 255, 0.12)" },
  libFilterActiveBorder: { l: "rgba(37, 99, 235, 0.25)",               d: "rgba(0, 245, 255, 0.3)" },
  libFilterActiveText:   { l: "#2563EB",                                d: "#00F5FF" },
  libFilterIdleBg:       { l: "rgba(15, 20, 25, 0.03)",                d: "rgba(255, 255, 255, 0.03)" },
  libFilterIdleBorder:   { l: "rgba(15, 20, 25, 0.08)",                d: "rgba(255, 255, 255, 0.08)" },
  libFilterIdleText:     { l: "#8089A0",                                d: "rgba(255, 255, 255, 0.4)" },
  libNodeName:     { l: "#4A5360",                                     d: "#B0BCD4" },
  libNodeNameHover:{ l: "#0F1419",                                     d: "#E8EDF8" },
  libHintBorder:   { l: "rgba(15, 20, 25, 0.06)",                      d: "rgba(255, 255, 255, 0.05)" },
  libBadgeBg:      { l: "rgba(5, 150, 105, 0.10)",                     d: "rgba(0, 245, 255, 0.1)" },
  libBadgeText:    { l: "#059669",                                     d: "#00F5FF" },
  libBadgeBorder:  { l: "rgba(5, 150, 105, 0.20)",                     d: "rgba(0, 245, 255, 0.2)" },
  libCountBg:      { l: "rgba(37, 99, 235, 0.06)",                     d: "rgba(0, 245, 255, 0.06)" },
  libCountBorder:  { l: "rgba(37, 99, 235, 0.12)",                     d: "rgba(0, 245, 255, 0.12)" },
  libCountText:    { l: "#2563EB",                                     d: "rgba(0, 245, 255, 0.5)" },
  libGrip:         { l: "#BCC2CE",                                     d: "rgba(255, 255, 255, 0.2)" },
  libBg:           { l: "#FFFFFF",                                     d: "rgba(10, 12, 16, 0.92)" },
  libBgHover:      { l: "#FBFAF7",                                     d: "rgba(255, 255, 255, 0.04)" },
  libBorder:       { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.10)" },
  libTabActiveBg:  { l: "#DBE5FF",                                     d: "rgba(0, 245, 255, 0.10)" },
  libTabActiveText:{ l: "#1E40AF",                                     d: "#00F5FF" },
  libTabActiveBorder: { l: "rgba(30, 64, 175, 0.20)",                  d: "rgba(0, 245, 255, 0.25)" },

  // ── Node V3 card ──────────────────────────────────────────────
  nodeBg:          { l: "#FFFFFF",                                     d: "rgba(10, 12, 14, 0.75)" },
  nodeBorder:      { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.08)" },
  nodeBorderHover: { l: "rgba(15, 20, 25, 0.16)",                      d: "rgba(255, 255, 255, 0.15)" },
  nodeShadow:      { l: "0 2px 4px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.06)",
                     d: "0 4px 24px rgba(0,0,0,0.5)" },
  nodeShadowHover: { l: "0 4px 8px rgba(15,20,25,0.04), 0 12px 32px rgba(15,20,25,0.08)",
                     d: "0 16px 48px rgba(0,0,0,0.65)" },
  nodeShadowSelected: { l: "0 4px 8px rgba(15,20,25,0.04), 0 12px 32px rgba(15,20,25,0.08), 0 0 0 3px rgba(37,99,235,0.18)",
                        d: "0 16px 48px rgba(0,0,0,0.65)" },
  nodeDivider:     { l: "rgba(15, 20, 25, 0.06)",                      d: "rgba(255, 255, 255, 0.06)" },
  nodeFooterBg:    { l: "#FBFAF7",                                     d: "rgba(0, 0, 0, 0.2)" },
  nodeStatBg:      { l: "#FBFAF7",                                     d: "rgba(184, 115, 51, 0.08)" },
  nodeStatBorder:  { l: "rgba(15, 20, 25, 0.06)",                      d: "rgba(184, 115, 51, 0.15)" },
  nodeStatusIdleBg:       { l: "#FBFAF7",                               d: "transparent" },
  nodeStatusIdleText:     { l: "#8089A0",                               d: "rgba(255, 255, 255, 0.4)" },
  nodeStatusRunningBg:    { l: "rgba(37, 99, 235, 0.10)",               d: "rgba(255, 191, 0, 0.12)" },
  nodeStatusRunningText:  { l: "#2563EB",                               d: "#FFBF00" },
  nodeStatusSuccessBg:    { l: "rgba(5, 150, 105, 0.10)",               d: "rgba(16, 185, 129, 0.12)" },
  nodeStatusSuccessText:  { l: "#059669",                               d: "#10B981" },
  nodeStatusErrorBg:      { l: "rgba(220, 38, 38, 0.10)",               d: "rgba(239, 68, 68, 0.12)" },
  nodeStatusErrorText:    { l: "#DC2626",                               d: "#EF4444" },
  nodeProgressTrack:      { l: "rgba(37, 99, 235, 0.10)",               d: "rgba(255, 191, 0, 0.10)" },

  // ── Edge callout chips ────────────────────────────────────────
  edgeCalloutBg:     { l: "rgba(255, 255, 255, 0.96)",                  d: "rgba(10, 12, 16, 0.95)" },
  edgeCalloutText:   { l: "#4A5360",                                    d: "#9898B0" },
  edgeCalloutBorder: { l: "rgba(15, 20, 25, 0.10)",                     d: "rgba(255, 255, 255, 0.10)" },

  // ── Canvas Controls ───────────────────────────────────────────
  controlBg:         { l: "#FFFFFF",                                    d: "rgba(10, 12, 16, 0.88)" },
  controlBorder:     { l: "rgba(15, 20, 25, 0.10)",                     d: "rgba(255, 255, 255, 0.08)" },
  controlShadow:     { l: "0 1px 2px rgba(15,20,25,0.04), 0 1px 4px rgba(15,20,25,0.04)",
                       d: "0 4px 24px rgba(0,0,0,0.4)" },
  controlBtnHover:   { l: "#FBFAF7",                                    d: "rgba(255, 255, 255, 0.06)" },
  controlBtnActiveBg:   { l: "#DBE5FF",                                 d: "rgba(0, 245, 255, 0.10)" },
  controlBtnActiveText: { l: "#1E40AF",                                 d: "#00F5FF" },
  controlBtnText:    { l: "#4A5360",                                    d: "rgba(255, 255, 255, 0.7)" },

  // ── Quick Search ──────────────────────────────────────────────
  qsOverlay:       { l: "rgba(15, 20, 25, 0.35)",                      d: "rgba(0, 0, 0, 0.65)" },
  qsModalBg:       { l: "#FFFFFF",                                     d: "rgba(12, 13, 16, 0.98)" },
  qsModalBorder:   { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.10)" },
  qsModalShadow:   { l: "0 8px 16px rgba(15,20,25,0.06), 0 24px 64px rgba(15,20,25,0.10)",
                     d: "0 16px 48px rgba(0, 0, 0, 0.6)" },
  qsInputText:     { l: "#0F1419",                                     d: "#F0F0F5" },
  qsInputPlaceholder: { l: "#BCC2CE",                                  d: "rgba(255, 255, 255, 0.35)" },
  qsRowHover:      { l: "#FBFAF7",                                     d: "rgba(255, 255, 255, 0.06)" },
  qsRowActive:     { l: "rgba(37, 99, 235, 0.08)",                     d: "rgba(0, 245, 255, 0.10)" },
  qsSectionLabel:  { l: "#8089A0",                                     d: "rgba(255, 255, 255, 0.5)" },
  qsFootBg:        { l: "#FBFAF7",                                     d: "rgba(7, 8, 9, 0.92)" },
  qsFootBorder:    { l: "rgba(15, 20, 25, 0.06)",                      d: "rgba(255, 255, 255, 0.06)" },
  qsKbdBg:         { l: "#FFFFFF",                                     d: "rgba(255, 255, 255, 0.04)" },
  qsKbdBorder:     { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.10)" },
  qsKbdText:       { l: "#4A5360",                                     d: "rgba(255, 255, 255, 0.7)" },

  // ── Ghost edge (Smart Connect) ────────────────────────────────
  ghostEdge:       { l: "#2563EB",                                     d: "#00F5FF" },
  ghostEdgeInvalid:{ l: "#DC2626",                                     d: "#EF4444" },

  // ── Smart Guides ──────────────────────────────────────────────
  guideLine:       { l: "#EC4899",                                     d: "#EC4899" },

  // ── Sticky comments ───────────────────────────────────────────
  stickyBg:        { l: "linear-gradient(180deg, #FEF3C7, #FDE68A)",
                     d: "linear-gradient(180deg, rgba(254,243,199,0.95), rgba(253,230,138,0.95))" },
  stickyBorder:    { l: "rgba(180, 83, 9, 0.20)",                      d: "rgba(180, 83, 9, 0.40)" },
  stickyText:      { l: "rgba(69, 26, 3, 0.95)",                       d: "rgba(40, 16, 2, 0.95)" },
  stickyTextMeta:  { l: "rgba(120, 53, 15, 0.85)",                     d: "rgba(80, 35, 10, 0.80)" },
  stickyResolved:  { l: "rgba(15, 20, 25, 0.06)",                      d: "rgba(0, 0, 0, 0.30)" },

  // ── Thread modal ──────────────────────────────────────────────
  threadBg:        { l: "#FFFFFF",                                     d: "rgba(12, 13, 16, 0.98)" },
  threadBorder:    { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.10)" },
  threadShadow:    { l: "0 8px 32px rgba(15, 20, 25, 0.10)",           d: "0 16px 48px rgba(0, 0, 0, 0.6)" },
  threadDivider:   { l: "rgba(15, 20, 25, 0.06)",                      d: "rgba(255, 255, 255, 0.06)" },
  threadInputBg:   { l: "#FBFAF7",                                     d: "rgba(255, 255, 255, 0.04)" },
  threadInputBorder: { l: "rgba(15, 20, 25, 0.10)",                    d: "rgba(255, 255, 255, 0.10)" },

  // ── Mention popover ───────────────────────────────────────────
  mentionPopBg:    { l: "#FFFFFF",                                     d: "rgba(12, 13, 16, 0.98)" },
  mentionPopBorder:{ l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.10)" },
  mentionPopShadow:{ l: "0 4px 12px rgba(15,20,25,0.08)",              d: "0 8px 24px rgba(0, 0, 0, 0.6)" },
  mentionHover:    { l: "#FBFAF7",                                     d: "rgba(255, 255, 255, 0.06)" },
  mentionActive:   { l: "rgba(37, 99, 235, 0.08)",                     d: "rgba(0, 245, 255, 0.10)" },

  // ── Group frames ──────────────────────────────────────────────
  groupLabelBg:    { l: "#FFFFFF",                                     d: "rgba(10, 12, 16, 0.95)" },
  groupLabelBorder:{ l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(255, 255, 255, 0.10)" },
  groupResizeHandle: { l: "rgba(15, 20, 25, 0.20)",                    d: "rgba(255, 255, 255, 0.20)" },
  groupDraggingShadow: { l: "0 4px 16px rgba(15, 20, 25, 0.10)",       d: "0 8px 32px rgba(0, 0, 0, 0.5)" },

  // Group color palette (indexed by color name)
  groupPurple:       { l: "rgba(124, 58, 237, 0.30)",                  d: "rgba(139, 92, 246, 0.40)" },
  groupPurpleBg:     { l: "rgba(124, 58, 237, 0.025)",                 d: "rgba(139, 92, 246, 0.04)" },
  groupPurpleLabel:  { l: "#7C3AED",                                   d: "#B79CFA" },
  groupBlue:         { l: "rgba(37, 99, 235, 0.30)",                   d: "rgba(96, 165, 250, 0.40)" },
  groupBlueBg:       { l: "rgba(37, 99, 235, 0.025)",                  d: "rgba(96, 165, 250, 0.04)" },
  groupBlueLabel:    { l: "#2563EB",                                   d: "#93BBFC" },
  groupGreen:        { l: "rgba(21, 128, 61, 0.30)",                   d: "rgba(74, 222, 128, 0.40)" },
  groupGreenBg:      { l: "rgba(21, 128, 61, 0.025)",                  d: "rgba(74, 222, 128, 0.04)" },
  groupGreenLabel:   { l: "#15803D",                                   d: "#86EFAC" },
  groupOrange:       { l: "rgba(234, 88, 12, 0.30)",                   d: "rgba(251, 146, 60, 0.40)" },
  groupOrangeBg:     { l: "rgba(234, 88, 12, 0.025)",                  d: "rgba(251, 146, 60, 0.04)" },
  groupOrangeLabel:  { l: "#EA580C",                                   d: "#FDBA74" },
  groupGray:         { l: "rgba(75, 85, 99, 0.30)",                    d: "rgba(156, 163, 175, 0.40)" },
  groupGrayBg:       { l: "rgba(75, 85, 99, 0.025)",                   d: "rgba(156, 163, 175, 0.04)" },
  groupGrayLabel:    { l: "#4B5563",                                   d: "#D1D5DB" },

  // ── Minimap ───────────────────────────────────────────────────
  minimapBg:       { l: "rgba(255, 255, 255, 0.92)",                   d: "rgba(10, 12, 14, 0.85)" },
  minimapBorder:   { l: "rgba(15, 20, 25, 0.10)",                      d: "rgba(184, 115, 51, 0.1)" },
  minimapMask:     { l: "rgba(15, 20, 25, 0.04)",                      d: "rgba(7, 8, 9, 0.7)" },
} as const;

type TokenKey = keyof typeof T;

// ─── Resolved token record type ──────────────────────────────────────────────

type ResolvedTokens = { readonly [K in TokenKey]: string };

function resolve(isLight: boolean): ResolvedTokens {
  const result: Record<string, string> = {};
  for (const key in T) {
    const pair = T[key as TokenKey];
    result[key] = isLight ? pair.l : pair.d;
  }
  return result as ResolvedTokens;
}

const LIGHT_TOKENS = resolve(true);
const DARK_TOKENS = resolve(false);

/**
 * Hook: returns the full resolved token record for the current canvas theme.
 *
 * Usage:
 *   const t = useCanvasToken();
 *   <div style={{ background: t.surface1, color: t.text1 }} />
 */
export function useCanvasToken(): ResolvedTokens {
  const isLight = useCanvasTheme((s) => s.theme === "light");
  return isLight ? LIGHT_TOKENS : DARK_TOKENS;
}

/**
 * Hook: returns just the boolean isLight flag.
 */
export function useIsLight(): boolean {
  return useCanvasTheme((s) => s.theme === "light");
}

/**
 * Resolve a group color set by color name.
 */
export function resolveGroupColor(color: string, isLight: boolean) {
  const tokens = isLight ? LIGHT_TOKENS : DARK_TOKENS;
  const c = color.charAt(0).toUpperCase() + color.slice(1);
  const borderKey = `group${c}` as TokenKey;
  const bgKey = `group${c}Bg` as TokenKey;
  const labelKey = `group${c}Label` as TokenKey;
  return {
    border: tokens[borderKey] ?? tokens.groupPurple,
    bg: tokens[bgKey] ?? tokens.groupPurpleBg,
    label: tokens[labelKey] ?? tokens.groupPurpleLabel,
  };
}
