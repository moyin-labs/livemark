import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import DOMPurify from "dompurify";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import { headingIDs, resolveResource, getDocumentLanguage } from "./resources";
import { renderDiagram } from "./visual_blocks";
const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight: (str, lang) =>
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
      : "",
});
md.use(taskLists, { enabled: false }).use(footnote as any);
// 预览与导出和编辑器共用表格滚动容器，窄窗口只滚动表格本身。
md.renderer.rules.table_open = () => '<div class="tableWrapper"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';
md.inline.ruler.before("emphasis", "highlight", (state, silent) => {
  const m = /^==([^=\n]+)==/.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) {
    state.push("mark_open", "mark", 1);
    const t = state.push("text", "", 0);
    t.content = m[1];
    state.push("mark_close", "mark", -1);
  }
  state.pos += m[0].length;
  return true;
});
md.inline.ruler.before("escape", "math", (state, silent) => {
  const m = /^\$([^$\n]+)\$/.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) {
    const t = state.push("math_inline", "", 0);
    t.content = m[1];
  }
  state.pos += m[0].length;
  return true;
});
md.renderer.rules.math_inline = (tokens, index) =>
  katex.renderToString(tokens[index].content, {
    throwOnError: false,
    strict: false,
  });
const fence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, index, options, env, renderer) =>
  tokens[index].info.trim() === "mermaid"
    ? `<div class="mermaid-preview" data-source="${md.utils.escapeHtml(tokens[index].content)}"></div>`
    : fence(tokens, index, options, env, renderer);
export function renderToHtmlString(text: string): string {
  const language = getDocumentLanguage();
  if (language !== null) {
    const content = hljs.getLanguage(language)
      ? hljs.highlight(text, { language, ignoreIllegals: true }).value
      : md.utils.escapeHtml(text);
    return `<pre><code class="language-${language}">${content}</code></pre>`;
  }
  const html = DOMPurify.sanitize(
    md.render(
      text
        .replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\n/, "")
        .replace(/^\$\$\s*\n([\s\S]*?)\n\$\$\s*$/gm, (_, latex) =>
          katex.renderToString(latex, {
            displayMode: true,
            throwOnError: false,
            strict: false,
          }),
        ),
    ),
    { ADD_TAGS: ["annotation", "semantics"], ADD_ATTR: ["encoding"] },
  );
  const wrapper = document.createElement("article");
  wrapper.innerHTML = html;
  const headings = Array.from(
    wrapper.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
  );
  const ids = headingIDs(headings.map((h) => h.textContent || ""));
  headings.forEach((h, i) => {
    h.id = ids[i];
  });
  return wrapper.innerHTML;
}
export async function renderPreview(
  target: HTMLElement,
  text: string,
): Promise<void> {
  target.innerHTML = renderToHtmlString(text);
  target.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6").forEach((h) => {
    h.id = `preview-${h.id}`;
  });
  target.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    img.src = resolveResource(img.getAttribute("src") || "");
  });
  for (const diagram of target.querySelectorAll<HTMLElement>(
    ".mermaid-preview",
  )) {
    try {
      diagram.innerHTML = await renderDiagram(diagram.dataset.source || "");
    } catch {
      diagram.textContent = diagram.dataset.source || "";
      diagram.classList.add("diagram-error");
    }
  }
}
