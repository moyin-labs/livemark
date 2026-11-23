import previewCss from "../static/style/preview.css";
import kernelCss from "../static/style/kernel.css";
import katexCss from "katex/dist/katex.min.css";
import type { Bridge } from "./bridge";
import { getEditorContent, waitForImages } from "./editor";
import { renderToHtmlString } from "./preview";
import { embeddedResource } from "./resources";
import { renderDiagram } from "./visual_blocks";
import { setupDocumentWidth } from "./document_width";
import ptSerifLicense from "../static/style/fonts/PTSerif-OFL.txt";
export function setupExport(bridge: Bridge): void {
  bridge.registerHandler(
    "export.requestHtml",
    async ({ standalone }: { standalone?: boolean }) => {
      await waitForImages();
      const article = document.createElement("article");
      article.className = "document";
      article.innerHTML = renderToHtmlString(getEditorContent());
      await Promise.all(
        Array.from(article.querySelectorAll<HTMLImageElement>("img")).map(
          async (img) => {
            img.src = await embeddedResource(img.getAttribute("src") || "");
          },
        ),
      );
      for (const diagram of article.querySelectorAll<HTMLElement>(
        ".mermaid-preview",
      )) {
        try {
          diagram.innerHTML = await renderDiagram(diagram.dataset.source || "");
        } catch {
          diagram.textContent = diagram.dataset.source || "";
        }
      }
      if (!standalone) return { html: article.innerHTML };
      // 正文与KaTeX字体由native侧内联，脱离应用目录后仍可离线打开。
      const html = `<!DOCTYPE html>\n<html lang="zh-CN" data-theme="${document.documentElement.dataset.theme || "newsprint"}" data-font="${document.documentElement.dataset.font || "ptserif"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markdown文档</title><style>/* PT Serif许可\n${ptSerifLicense}\n*/\n${kernelCss}\n${previewCss}\n${katexCss}\nhtml,body{height:auto;overflow:visible}body{margin:0}article.document{width:100%;max-width:min(var(--content-width,var(--paper-width)),var(--paper-max-width));margin:auto;padding:40px var(--paper-gutter)}pre{break-inside:avoid}@media print{article.document{max-width:none;padding:0}}</style></head><body>${article.outerHTML}<script>(${setupDocumentWidth.toString()})(document.querySelector('article.document'));</script></body></html>`;
      return { html };
    },
  );
}
