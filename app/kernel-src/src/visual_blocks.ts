import mermaid from "mermaid";
let counter = 0;
let queue = Promise.resolve();
export function renderDiagram(source: string): Promise<string> {
  const result = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme:
        document.documentElement.dataset.theme === "dark" ? "dark" : "default",
      suppressErrorRendering: true,
    });
    const { svg } = await mermaid.render(
      `diagram-${++counter}`,
      source || "graph LR\n A-->B",
    );
    return svg;
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
