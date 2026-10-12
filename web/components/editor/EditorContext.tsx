"use client";

import { createContext, useContext } from "react";
import type { Issue, NodeRunState } from "@app/shared";

/**
 * Per-node information the canvas nodes need but that doesn't belong in the
 * node's own `data` (which is what gets saved): validation issues and the
 * live state of the current run.
 */
export interface EditorContextValue {
  issuesByNode: Map<string, Issue[]>;
  runStateByNode: Record<string, NodeRunState>;
  currentNodeId: string | null;
}

export const EditorContext = createContext<EditorContextValue>({
  issuesByNode: new Map(),
  runStateByNode: {},
  currentNodeId: null,
});

export const useEditorContext = () => useContext(EditorContext);
