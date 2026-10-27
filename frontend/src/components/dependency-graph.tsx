"use client";

import { useMemo } from "react";
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type GraphDocument = { id: number; title: string; depth: number };
type GraphReference = { source: number; target: number; type: string };

export function DependencyGraph({ documents, references }: { documents: GraphDocument[]; references: GraphReference[] }) {
  const nodes = useMemo<Node[]>(() => {
    const rowByDepth = new Map<number, number>();
    return documents.map(document => {
      const row = rowByDepth.get(document.depth) ?? 0;
      rowByDepth.set(document.depth, row + 1);
      return {
        id: String(document.id),
        position: { x: document.depth * 260, y: row * 120 },
        data: { label: document.title },
        style: { width: 210, border: "1px solid #9bb8ad", borderRadius: 10, padding: 12, background: "#f4f9f7", color: "#17342d" }
      };
    });
  }, [documents]);

  const edges = useMemo<Edge[]>(() => references.map(reference => ({
    id: `${reference.source}-${reference.target}-${reference.type}`,
    source: String(reference.source),
    target: String(reference.target),
    label: reference.type.replaceAll("_", " "),
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#527b6e" },
    labelStyle: { fill: "#52645f", fontSize: 11 }
  })), [references]);

  if (documents.length === 0) return <p>No dependency graph data is available.</p>;

  return (
    <div style={{ height: 480, border: "1px solid #dce5e2", borderRadius: 10, overflow: "hidden" }}>
      <ReactFlow nodes={nodes} edges={edges} fitView nodesConnectable={false} elementsSelectable>
        <Background color="#dce5e2" gap={22} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
