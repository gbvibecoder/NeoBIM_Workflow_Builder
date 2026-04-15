/**
 * Project Persistence — localStorage save/load for FloorPlanProject
 *
 * Features:
 * - Save/load individual projects by ID
 * - Project index (list of saved projects with metadata)
 * - Auto-save with debounce
 * - Export/import as .buildflow.json files
 */

import type { FloorPlanProject } from "@/types/floor-plan-cad";

const STORAGE_PREFIX = "buildflow-fp-";
const INDEX_KEY = "buildflow-fp-index";
const ACTIVE_KEY = "buildflow-fp-active";

// ============================================================
// PROJECT INDEX
// ============================================================

export interface ProjectIndexEntry {
  id: string;
  name: string;
  updatedAt: string;
  roomCount: number;
  floorCount: number;
  thumbnail?: string; // base64 thumbnail (future)
}

export function getProjectIndex(): ProjectIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setProjectIndex(index: ProjectIndexEntry[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

// ============================================================
// SAVE / LOAD
// ============================================================

export function saveProject(project: FloorPlanProject): void {
  const key = STORAGE_PREFIX + project.id;
  const data = JSON.stringify(project);

  try {
    localStorage.setItem(key, data);
  } catch (e) {
    // localStorage might be full — try to evict oldest project with user consent
    const index = getProjectIndex();
    if (index.length > 5) {
      const oldest = index.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
      if (oldest) {
        const confirmed = typeof window !== "undefined"
          ? window.confirm(`Storage is full. Delete oldest project "${oldest.name}" to make room?`)
          : false;
        if (!confirmed) {
          console.warn("User declined — project not saved (storage full)");
          return;
        }
        localStorage.removeItem(STORAGE_PREFIX + oldest.id);
        index.splice(index.indexOf(oldest), 1);
        setProjectIndex(index);
      }
      // Retry
      try {
        localStorage.setItem(key, data);
      } catch {
        console.warn("Failed to save project — localStorage still full after eviction");
        return;
      }
    }
  }

  // Update index
  const index = getProjectIndex();
  const existing = index.findIndex((e) => e.id === project.id);
  const entry: ProjectIndexEntry = {
    id: project.id,
    name: project.name,
    updatedAt: new Date().toISOString(),
    roomCount: project.floors.reduce((s, f) => s + f.rooms.length, 0),
    floorCount: project.floors.length,
  };

  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }

  setProjectIndex(index);
}

export function loadProject(projectId: string): FloorPlanProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + projectId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteProject(projectId: string): void {
  localStorage.removeItem(STORAGE_PREFIX + projectId);
  const index = getProjectIndex().filter((e) => e.id !== projectId);
  setProjectIndex(index);
  // If the user just deleted the project that was last on-screen, forget it
  // so the next page load doesn't try to restore a project we no longer have.
  try {
    if (typeof window !== "undefined" && localStorage.getItem(ACTIVE_KEY) === projectId) {
      localStorage.removeItem(ACTIVE_KEY);
    }
  } catch { /* best-effort */ }
}

export function getLastProjectId(): string | null {
  const index = getProjectIndex();
  if (index.length === 0) return null;
  return index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id;
}

// ============================================================
// ACTIVE PROJECT TRACKING
// ============================================================
//
// A separate pointer that records which project the user currently has
// on-screen. Distinct from the full project index because "most recently
// updated" isn't the same as "currently open" — a user who hits Back from
// the editor expects the Welcome screen next, even though the project is
// still in the index.

export function setActiveProjectId(projectId: string): void {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(ACTIVE_KEY, projectId);
    }
  } catch { /* best-effort */ }
}

export function getActiveProjectId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function clearActiveProjectId(): void {
  try {
    if (typeof window !== "undefined") {
      localStorage.removeItem(ACTIVE_KEY);
    }
  } catch { /* best-effort */ }
}

// ============================================================
// AUTO-SAVE (debounced)
// ============================================================

let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutoSave(project: FloorPlanProject, delayMs: number = 2000): void {
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    saveProject(project);
    _autoSaveTimer = null;
  }, delayMs);
}

export function cancelAutoSave(): void {
  if (_autoSaveTimer) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
}

// ============================================================
// FILE EXPORT / IMPORT
// ============================================================

export function exportProjectFile(project: FloorPlanProject): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.name.replace(/[^a-zA-Z0-9]/g, "_")}.buildflow.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importProjectFile(): Promise<FloorPlanProject | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.buildflow.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        const text = await file.text();
        const project = JSON.parse(text) as FloorPlanProject;
        // Basic validation
        if (!project.id || !project.floors || !Array.isArray(project.floors)) {
          console.warn("Invalid project file");
          resolve(null);
          return;
        }
        resolve(project);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
