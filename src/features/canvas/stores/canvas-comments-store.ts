import { create } from "zustand";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommentAuthor {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface CanvasComment {
  id: string;
  workflowId: string;
  authorId: string;
  author: CommentAuthor;
  parentId: string | null;
  body: string;
  mentions: string[];
  positionX: number;
  positionY: number;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
  updatedAt: string;
  replies?: CanvasComment[];
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface CommentsState {
  comments: CanvasComment[];
  isLoading: boolean;
  error: string | null;
  activeCommentId: string | null;
  composerPosition: { x: number; y: number } | null;
  filterResolved: "all" | "open" | "resolved";

  fetchComments: (workflowId: string) => Promise<void>;
  createComment: (workflowId: string, position: { x: number; y: number }, body: string, mentions?: string[]) => Promise<void>;
  updateComment: (id: string, body: string, mentions?: string[]) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  resolveComment: (id: string) => Promise<void>;
  addReply: (parentId: string, body: string, mentions?: string[]) => Promise<void>;
  setActiveComment: (id: string | null) => void;
  setComposerPosition: (pos: { x: number; y: number } | null) => void;
  setFilter: (filter: "all" | "open" | "resolved") => void;

  // Pusher event handlers (for real-time sync)
  onCommentCreated: (comment: CanvasComment) => void;
  onCommentUpdated: (comment: CanvasComment) => void;
  onCommentDeleted: (commentId: string) => void;
}

export const useCanvasComments = create<CommentsState>((set, get) => ({
  comments: [],
  isLoading: false,
  error: null,
  activeCommentId: null,
  composerPosition: null,
  filterResolved: "all",

  fetchComments: async (workflowId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`/api/workflows/${workflowId}/comments`);
      if (!res.ok) throw new Error("Failed to fetch comments");
      const data = await res.json();
      set({ comments: data.comments ?? [], isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error", isLoading: false });
    }
  },

  createComment: async (workflowId, position, body, mentions) => {
    try {
      const res = await fetch(`/api/workflows/${workflowId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body, positionX: position.x, positionY: position.y, mentions }),
      });
      if (!res.ok) throw new Error("Failed to create comment");
      const data = await res.json();
      set((s) => ({ comments: [data.comment, ...s.comments], composerPosition: null }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  updateComment: async (id, body, mentions) => {
    try {
      const res = await fetch(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body, mentions }),
      });
      if (!res.ok) throw new Error("Failed to update");
      const data = await res.json();
      set((s) => ({ comments: s.comments.map((c) => (c.id === id ? data.comment : c)) }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  deleteComment: async (id) => {
    try {
      await fetch(`/api/comments/${id}`, { method: "DELETE" });
      set((s) => ({ comments: s.comments.filter((c) => c.id !== id), activeCommentId: s.activeCommentId === id ? null : s.activeCommentId }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  resolveComment: async (id) => {
    try {
      const res = await fetch(`/api/comments/${id}/resolve`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to resolve");
      const data = await res.json();
      set((s) => ({ comments: s.comments.map((c) => (c.id === id ? data.comment : c)) }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  addReply: async (parentId, body, mentions) => {
    try {
      const res = await fetch(`/api/comments/${parentId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body, mentions }),
      });
      if (!res.ok) throw new Error("Failed to reply");
      const data = await res.json();
      // Add reply to parent's replies array
      set((s) => ({
        comments: s.comments.map((c) =>
          c.id === parentId ? { ...c, replies: [...(c.replies ?? []), data.reply] } : c
        ),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  setActiveComment: (id) => set({ activeCommentId: id }),
  setComposerPosition: (pos) => set({ composerPosition: pos }),
  setFilter: (filter) => set({ filterResolved: filter }),

  // Pusher event handlers
  onCommentCreated: (comment) => {
    set((s) => {
      if (s.comments.some((c) => c.id === comment.id)) return s;
      return { comments: [comment, ...s.comments] };
    });
  },
  onCommentUpdated: (comment) => {
    set((s) => ({ comments: s.comments.map((c) => (c.id === comment.id ? comment : c)) }));
  },
  onCommentDeleted: (commentId) => {
    set((s) => ({ comments: s.comments.filter((c) => c.id !== commentId) }));
  },
}));

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectComments = (s: CommentsState) => s.comments;
export const selectActiveCommentId = (s: CommentsState) => s.activeCommentId;
export const selectComposerPosition = (s: CommentsState) => s.composerPosition;
export const selectFilterResolved = (s: CommentsState) => s.filterResolved;
export const selectFetchComments = (s: CommentsState) => s.fetchComments;
export const selectCreateComment = (s: CommentsState) => s.createComment;
export const selectSetActiveComment = (s: CommentsState) => s.setActiveComment;
export const selectSetComposerPosition = (s: CommentsState) => s.setComposerPosition;
export const selectResolveComment = (s: CommentsState) => s.resolveComment;
export const selectAddReply = (s: CommentsState) => s.addReply;
export const selectDeleteComment = (s: CommentsState) => s.deleteComment;
