import { create } from "zustand";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GroupColor = "purple" | "blue" | "green" | "orange" | "gray";

export interface CanvasGroup {
  id: string;
  workflowId: string;
  label: string;
  color: GroupColor;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface DrawingGroupState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface GroupsState {
  groups: CanvasGroup[];
  isLoading: boolean;
  error: string | null;
  activeGroupId: string | null;
  drawingGroup: DrawingGroupState | null;

  fetchGroups: (workflowId: string) => Promise<void>;
  createGroup: (workflowId: string, rect: { x: number; y: number; w: number; h: number }, label?: string, color?: GroupColor) => Promise<void>;
  updateGroup: (id: string, partial: Partial<Pick<CanvasGroup, "label" | "color" | "positionX" | "positionY" | "width" | "height">>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  setActiveGroup: (id: string | null) => void;
  setDrawingGroup: (state: DrawingGroupState | null) => void;

  // Pusher event handlers
  onGroupCreated: (group: CanvasGroup) => void;
  onGroupUpdated: (group: CanvasGroup) => void;
  onGroupDeleted: (groupId: string) => void;
}

export const useCanvasGroups = create<GroupsState>((set) => ({
  groups: [],
  isLoading: false,
  error: null,
  activeGroupId: null,
  drawingGroup: null,

  fetchGroups: async (workflowId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`/api/workflows/${workflowId}/groups`);
      if (!res.ok) throw new Error("Failed to fetch groups");
      const data = await res.json();
      set({ groups: data.groups ?? [], isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error", isLoading: false });
    }
  },

  createGroup: async (workflowId, rect, label, color) => {
    try {
      const res = await fetch(`/api/workflows/${workflowId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label ?? "Group",
          color: color ?? "purple",
          positionX: rect.x,
          positionY: rect.y,
          width: rect.w,
          height: rect.h,
        }),
      });
      if (!res.ok) throw new Error("Failed to create group");
      const data = await res.json();
      set((s) => ({ groups: [...s.groups, data.group], drawingGroup: null }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  updateGroup: async (id, partial) => {
    try {
      const res = await fetch(`/api/groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error("Failed to update group");
      const data = await res.json();
      set((s) => ({ groups: s.groups.map((g) => (g.id === id ? data.group : g)) }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  deleteGroup: async (id) => {
    try {
      await fetch(`/api/groups/${id}`, { method: "DELETE" });
      set((s) => ({ groups: s.groups.filter((g) => g.id !== id), activeGroupId: s.activeGroupId === id ? null : s.activeGroupId }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  setActiveGroup: (id) => set({ activeGroupId: id }),
  setDrawingGroup: (state) => set({ drawingGroup: state }),

  // Pusher event handlers
  onGroupCreated: (group) => {
    set((s) => {
      if (s.groups.some((g) => g.id === group.id)) return s;
      return { groups: [...s.groups, group] };
    });
  },
  onGroupUpdated: (group) => {
    set((s) => ({ groups: s.groups.map((g) => (g.id === group.id ? group : g)) }));
  },
  onGroupDeleted: (groupId) => {
    set((s) => ({ groups: s.groups.filter((g) => g.id !== groupId) }));
  },
}));

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectGroups = (s: GroupsState) => s.groups;
export const selectActiveGroupId = (s: GroupsState) => s.activeGroupId;
export const selectDrawingGroup = (s: GroupsState) => s.drawingGroup;
export const selectFetchGroups = (s: GroupsState) => s.fetchGroups;
export const selectCreateGroup = (s: GroupsState) => s.createGroup;
export const selectUpdateGroup = (s: GroupsState) => s.updateGroup;
export const selectDeleteGroup = (s: GroupsState) => s.deleteGroup;
export const selectSetActiveGroup = (s: GroupsState) => s.setActiveGroup;
export const selectSetDrawingGroup = (s: GroupsState) => s.setDrawingGroup;
