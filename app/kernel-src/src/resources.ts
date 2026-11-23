let documentPath = "";
let resourceVersion = 0;
const cache = new Map<string, Promise<string>>();
export function setDocumentPath(path: string): void {
  documentPath = path;
  cache.clear();
  resourceVersion++;
}
export function getDocumentPath(): string {
  return documentPath;
}
export function getDocumentLanguage(): string | null {
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(documentPath)
    ? new URL(documentPath).pathname
    : documentPath;
  const filename = path.split(/[\\/]/).pop() || "";
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (!extension || ["md", "markdown", "mdown", "mkd"].includes(extension)) return null;
  if (extension === "json") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  return "plaintext";
}
export function getResourceVersion(): number {
  return resourceVersion;
}
export function resolveResource(src: string): string {
  if (!src || /^(https?:|data:|blob:|livemark-resource:)/i.test(src))
    return src;
  if (/^(javascript:|vbscript:)/i.test(src)) return "";
  if (!window.webkit)
    return documentPath
      ? new URL(
          src,
          documentPath.startsWith("http")
            ? documentPath
            : `file://${documentPath}`,
        ).href
      : src;
  if (/^file:/i.test(src))
    return `livemark-resource://file${new URL(src).pathname}`;
  const base = documentPath
    ? new URL(`file://${documentPath}`)
    : new URL("file:///");
  return `livemark-resource://file${new URL(src, base).pathname}`;
}
export async function embeddedResource(src: string): Promise<string> {
  if (/^(data:|https?:)/i.test(src)) return src;
  if (window.webkit && window.__livemark) {
    try {
      const result = await window.__livemark.callHandler("file.readResource", {
        src,
      });
      return result.dataURL || src;
    } catch {
      return src;
    }
  }
  if (!cache.has(src))
    cache.set(
      src,
      fetch(resolveResource(src))
        .then(async (r) => {
          if (!r.ok) throw Error("图片读取失败");
          const blob = await r.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })
        .catch(() => src),
    );
  return cache.get(src)!;
}
export function slug(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-") || "section"
  );
}
export function headingIDs(texts: string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const key = slug(text),
      count = seen.get(key) || 0;
    seen.set(key, count + 1);
    return count ? `${key}-${count}` : key;
  });
}
