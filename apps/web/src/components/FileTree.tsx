interface FolderNode {
  path: string;
  type: "file" | "dir";
  description?: string;
}

export function FileTree({ nodes }: { nodes: FolderNode[] }) {
  if (nodes.length === 0) {
    return <p style={{ color: "#5c5c6f", fontSize: "14px" }}>No folder structure available.</p>;
  }

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "13px",
        lineHeight: 1.8,
        color: "#9898a8",
      }}
    >
      {nodes.map((node) => {
        const depth = node.path.split("/").length - 1;
        const name = node.path.split("/").pop() ?? node.path;
        const isDir = node.type === "dir";

        return (
          <div
            key={node.path}
            style={{
              paddingLeft: `${depth * 20}px`,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span style={{ color: isDir ? "#fbbf24" : "#6366f1", fontSize: "12px" }}>
              {isDir ? "📁" : "📄"}
            </span>
            <span style={{ color: isDir ? "#f0f0f5" : "#9898a8", fontWeight: isDir ? 500 : 400 }}>
              {name}
            </span>
            {node.description && (
              <span style={{ color: "#5c5c6f", fontSize: "11px", marginLeft: "8px" }}>
                — {node.description}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
