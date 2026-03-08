// ─── Gamification: XP, Levels, Missions, Flash Events ────────────────────────

// ── XP Table ─────────────────────────────────────────────────────────────────
// Level N requires XP_PER_LEVEL * N total XP from level 1.
// e.g. Level 2 = 500 XP, Level 3 = 1000 XP, etc.
const XP_PER_LEVEL = 500;
const MAX_LEVEL = 50;

export function levelFromXp(xp: number): { level: number; progress: number; xpForNext: number; xpInLevel: number } {
  const level = Math.min(Math.floor(xp / XP_PER_LEVEL) + 1, MAX_LEVEL);
  const xpForCurrentLevel = (level - 1) * XP_PER_LEVEL;
  const xpForNext = level * XP_PER_LEVEL;
  const xpInLevel = xp - xpForCurrentLevel;
  const progress = level >= MAX_LEVEL ? 100 : Math.round((xpInLevel / XP_PER_LEVEL) * 100);
  return { level, progress, xpForNext, xpInLevel };
}

// ── XP Awards per action ─────────────────────────────────────────────────────
export const XP_ACTIONS: Record<string, { xp: number; oneTime: boolean; label: string }> = {
  "workflow-created":   { xp: 100, oneTime: true,  label: "First Workflow Created" },
  "workflow-run":       { xp: 50,  oneTime: false, label: "Ran a Workflow" },
  "ai-prompt-used":     { xp: 75,  oneTime: true,  label: "AI Prompt Used" },
  "template-cloned":    { xp: 50,  oneTime: true,  label: "First Template Cloned" },
  "render-generated":   { xp: 100, oneTime: true,  label: "First Render Generated" },
  "boq-generated":      { xp: 100, oneTime: true,  label: "First BOQ Generated" },
  "flash-event":        { xp: 500, oneTime: false, label: "Flash Event Completed" },
  // Repeatable run XP (awarded every time, not one-time)
  "workflow-run-repeat": { xp: 15, oneTime: false, label: "Workflow Execution" },
};

// ── Missions ─────────────────────────────────────────────────────────────────
// Missions map to real actions. Status is derived from user achievements.
export interface Mission {
  id: string;
  title: string;
  description: string;
  action: string; // key in XP_ACTIONS (the one-time achievement that completes this)
  href: string;
  icon: "check" | "sparkles" | "compass" | "cable";
}

export const MISSIONS: Mission[] = [
  {
    id: "m1",
    title: "Initialize Node",
    description: "Create your first empty canvas to begin.",
    action: "workflow-created",
    href: "/dashboard/workflows/new",
    icon: "check",
  },
  {
    id: "m2",
    title: "AI Whispering",
    description: "Generate a workflow using a natural prompt.",
    action: "ai-prompt-used",
    href: "/dashboard/workflows/new",
    icon: "sparkles",
  },
  {
    id: "m3",
    title: "Pattern Hunter",
    description: "Browse and fork your first public template.",
    action: "template-cloned",
    href: "/dashboard/templates",
    icon: "compass",
  },
  {
    id: "m4",
    title: "The Integrator",
    description: "Connect a 3rd party API node.",
    action: "render-generated",
    href: "/dashboard/workflows/new",
    icon: "cable",
  },
];

// ── Loot / Blueprint Vault ───────────────────────────────────────────────────
export interface BlueprintDef {
  workflowIndex: number; // index in PREBUILT_WORKFLOWS
  rarity: "common" | "rare" | "epic" | "legendary";
  requiredLevel: number;
}

export const BLUEPRINTS: BlueprintDef[] = [
  { workflowIndex: 0, rarity: "rare",      requiredLevel: 1 },
  { workflowIndex: 1, rarity: "epic",      requiredLevel: 5 },
  { workflowIndex: 2, rarity: "legendary", requiredLevel: 8 },
];

export const RARITY_COLORS: Record<string, string> = {
  common:    "#6B7280",
  rare:      "#3B82F6",
  epic:      "#8B5CF6",
  legendary: "#F59E0B",
};

// ── Flash Events ─────────────────────────────────────────────────────────────
export interface FlashEventDef {
  key: string;
  title: string;
  description: string;
  href: string;
}

const FLASH_EVENTS: FlashEventDef[] = [
  { key: "run-3-workflows",    title: "Run 3 workflows today",     description: "Execute three different workflows before midnight UTC.", href: "/dashboard/workflows" },
  { key: "generate-2-renders", title: "Generate 2 renders",        description: "Use the Neural Render node twice today.",               href: "/dashboard/workflows/new" },
  { key: "try-ifc-pipeline",   title: "Try the IFC pipeline",      description: "Build and run a workflow with IFC parsing.",             href: "/dashboard/workflows/new" },
  { key: "clone-2-templates",  title: "Clone 2 community templates", description: "Fork two blueprints from the community vault.",       href: "/dashboard/templates" },
  { key: "ai-prompt-challenge",title: "AI Architect Challenge",     description: "Generate 2 workflows using AI prompts.",                href: "/dashboard/workflows/new" },
];

/** Returns today's flash event (rotates daily based on UTC date). */
export function todaysFlashEvent(): FlashEventDef & { eventKey: string } {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getUTCFullYear(), 0, 0).getTime()) / 86400000);
  const idx = dayOfYear % FLASH_EVENTS.length;
  const event = FLASH_EVENTS[idx];
  // Key includes date so completions are daily
  const dateStr = new Date().toISOString().slice(0, 10);
  return { ...event, eventKey: `${event.key}:${dateStr}` };
}

/** Milliseconds until midnight UTC. */
export function msUntilMidnightUTC(): number {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return midnight.getTime() - now.getTime();
}
