/**
 * Z.CANVAS.COLLAB-COMPLETE — Pusher real-time subscription for canvas collab.
 * Subscribes to private-canvas-{workflowId} and pipes events into stores.
 */

import { useEffect } from "react";
import { getPusherClient } from "@/lib/pusher-client";
import { useCanvasComments } from "@/features/canvas/stores/canvas-comments-store";
import { useCanvasGroups } from "@/features/canvas/stores/canvas-groups-store";
import type { CanvasComment } from "@/features/canvas/stores/canvas-comments-store";
import type { CanvasGroup } from "@/features/canvas/stores/canvas-groups-store";

export function useCanvasRealtime(workflowId: string | undefined) {

  const onCommentCreated = useCanvasComments((s) => s.onCommentCreated);
  const onCommentUpdated = useCanvasComments((s) => s.onCommentUpdated);
  const onCommentDeleted = useCanvasComments((s) => s.onCommentDeleted);
  const onGroupCreated = useCanvasGroups((s) => s.onGroupCreated);
  const onGroupUpdated = useCanvasGroups((s) => s.onGroupUpdated);
  const onGroupDeleted = useCanvasGroups((s) => s.onGroupDeleted);

  useEffect(() => {
    if (!workflowId) return;
    const pusher = getPusherClient();
    if (!pusher) return;

    const channelName = `private-canvas-${workflowId}`;
    const channel = pusher.subscribe(channelName);

    channel.bind("canvas-comment:created", (data: { comment: CanvasComment }) => {
      onCommentCreated(data.comment);
    });
    channel.bind("canvas-comment:updated", (data: { comment: CanvasComment }) => {
      onCommentUpdated(data.comment);
    });
    channel.bind("canvas-comment:deleted", (data: { commentId: string }) => {
      onCommentDeleted(data.commentId);
    });
    channel.bind("canvas-group:created", (data: { group: CanvasGroup }) => {
      onGroupCreated(data.group);
    });
    channel.bind("canvas-group:updated", (data: { group: CanvasGroup }) => {
      onGroupUpdated(data.group);
    });
    channel.bind("canvas-group:deleted", (data: { groupId: string }) => {
      onGroupDeleted(data.groupId);
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(channelName);
    };
  }, [workflowId, onCommentCreated, onCommentUpdated, onCommentDeleted, onGroupCreated, onGroupUpdated, onGroupDeleted]);
}
