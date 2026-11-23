import { Schema, Node as PMNode } from "prosemirror-model";
import {
  schema as commonSchema,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
} from "prosemirror-markdown";
import { tableNodes } from "prosemirror-tables";
import MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";

let nodes = commonSchema.spec.nodes
  .update("heading", {
    ...commonSchema.spec.nodes.get("heading")!,
    content: "inline*",
  })
  .update("list_item", {
    content: "paragraph block*",
    defining: true,
    attrs: { checked: { default: null } },
    parseDOM: [
      {
        tag: "li",
        getAttrs: (dom) => ({
          checked: dom.hasAttribute("data-checked")
            ? dom.getAttribute("data-checked") === "true"
            : null,
        }),
      },
    ],
    toDOM: (node) => [
      "li",
      node.attrs.checked === null
        ? {}
        : { "data-checked": String(node.attrs.checked), class: "task-item" },
      0,
    ],
  })
  .append(
    tableNodes({
      tableGroup: "block",
      cellContent: "paragraph+",
      cellAttributes: {
        align: {
          default: null,
          getFromDOM: (dom) => dom.style.textAlign || null,
          setDOMAttr: (value, attrs) => {
            if (value) attrs.style = `text-align:${value}`;
          },
        },
      },
    }),
  )
  .append({
    raw_inline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { html: { default: "" } },
      toDOM: (n) => ["code", { class: "raw-inline" }, n.attrs.html],
    },
    math_inline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { latex: { default: "" } },
      parseDOM: [
        {
          tag: "span[data-math]",
          getAttrs: (dom) => ({ latex: dom.getAttribute("data-math") }),
        },
      ],
      toDOM: (node) => [
        "span",
        { "data-math": node.attrs.latex },
        node.attrs.latex,
      ],
    },
    math_block: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      toDOM: () => ["div", { class: "math-block" }, 0],
    },
    raw_block: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      attrs: { kind: { default: "html" } },
      toDOM: () => ["pre", { class: "raw-block" }, 0],
    },
    footnote_ref: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { label: { default: "" } },
      toDOM: (n) => ["sup", { class: "footnote-ref" }, n.attrs.label],
    },
  });
export const schema = new Schema({
  nodes,
  marks: commonSchema.spec.marks.append({
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }],
      toDOM: () => ["del", 0],
    },
    underline: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
    highlight: { parseDOM: [{ tag: "mark" }], toDOM: () => ["mark", 0] },
  }),
});

// 将扩展语法显式映射为文档节点，避免富文本编辑时静默丢失原始内容。
const md = new MarkdownIt({ html: true, linkify: true });
md.block.ruler.before("fence", "math_block", (state, start, end, silent) => {
  const first = state.src
    .slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
    .trim();
  if (!first.startsWith("$$")) return false;
  if (silent) return true;
  let last = start,
    content = "";
  if (first.length > 4 && first.endsWith("$$")) content = first.slice(2, -2);
  else {
    for (last = start + 1; last < end; last++)
      if (
        state.src.slice(state.bMarks[last], state.eMarks[last]).trim() === "$$"
      )
        break;
    if (last === end) return false;
    content = state.getLines(start + 1, last, state.blkIndent, false);
  }
  const token = state.push("math_block", "", 0);
  token.content = content;
  token.map = [start, last + 1];
  state.line = last + 1;
  return true;
});
md.block.ruler.before("hr", "frontmatter", (state, start, end, silent) => {
  if (
    start !== 0 ||
    state.src.slice(state.bMarks[start], state.eMarks[start]).trim() !== "---"
  )
    return false;
  let last = start + 1;
  for (; last < end; last++)
    if (
      /^(---|\.\.\.)\s*$/.test(
        state.src.slice(state.bMarks[last], state.eMarks[last]),
      )
    )
      break;
  if (last === end) return false;
  if (silent) return true;
  const t = state.push("raw_block", "", 0);
  t.content = state.getLines(start, last + 1, 0, false);
  t.meta = { kind: "yaml" };
  state.line = last + 1;
  return true;
});
md.block.ruler.before(
  "paragraph",
  "footnote_definition",
  (state, start, end, silent) => {
    if (
      !/^\[\^[^\]]+\]:/.test(
        state.src.slice(state.bMarks[start], state.eMarks[start]),
      )
    )
      return false;
    if (silent) return true;
    let last = start + 1;
    while (
      last < end &&
      /^ {4}\S/.test(state.src.slice(state.bMarks[last], state.eMarks[last]))
    )
      last++;
    const t = state.push("raw_block", "", 0);
    t.content = state.getLines(start, last, 0, false);
    t.meta = { kind: "footnote" };
    state.line = last;
    return true;
  },
);
md.inline.ruler.before("emphasis", "highlight", (state, silent) => {
  const m = /^==([^=\n]+)==/.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) {
    state.push("highlight_open", "mark", 1);
    const t = state.push("inline", "", 0);
    t.children = [];
    state.md.inline.parse(m[1], state.md, state.env, t.children);
    state.push("highlight_close", "mark", -1);
  }
  state.pos += m[0].length;
  return true;
});
md.inline.ruler.before("escape", "math_inline", (state, silent) => {
  const rest = state.src.slice(state.pos);
  const match = /^\$([^$\n]+)\$/.exec(rest);
  if (!match) return false;
  if (!silent) {
    const t = state.push("math_inline", "", 0);
    t.meta = { latex: match[1] };
  }
  state.pos += match[0].length;
  return true;
});
md.inline.ruler.before("link", "footnote_ref", (state, silent) => {
  const match = /^\[\^([^\]]+)\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const t = state.push("footnote_ref", "", 0);
    t.meta = { label: match[1] };
  }
  state.pos += match[0].length;
  return true;
});
md.core.ruler.after("inline", "tasks_and_cells", (state) => {
  const out: Token[] = [],
    items: Token[] = [];
  let cell = false;
  for (const t of state.tokens) {
    if (t.type === "list_item_open") items.push(t);
    if (t.type === "list_item_close") items.pop();
    if (t.type === "th_open" || t.type === "td_open") cell = true;
    if (t.type === "th_close" || t.type === "td_close") cell = false;
    if (
      t.type === "inline" &&
      items.length &&
      t.children?.[0]?.type === "text"
    ) {
      const match = /^\[([ xX])\]\s+/.exec(t.children[0].content);
      if (match) {
        items[items.length - 1].attrSet(
          "checked",
          match[1] !== " " ? "true" : "false",
        );
        t.children[0].content = t.children[0].content.slice(match[0].length);
      }
    }
    if (cell && t.type === "inline")
      out.push(
        new Token("paragraph_open", "p", 1),
        t,
        new Token("paragraph_close", "p", -1),
      );
    else out.push(t);
  }
  state.tokens = out;
});
export const markdownParser = new MarkdownParser(schema, md, {
  ...defaultMarkdownParser.tokens,
  list_item: {
    block: "list_item",
    getAttrs: (t) => ({
      checked:
        t.attrGet("checked") === null ? null : t.attrGet("checked") === "true",
    }),
  },
  table: { block: "table" },
  tr: { block: "table_row" },
  th: {
    block: "table_header",
    getAttrs: (t) => ({ align: t.attrGet("style")?.split(":")[1] || null }),
  },
  td: {
    block: "table_cell",
    getAttrs: (t) => ({ align: t.attrGet("style")?.split(":")[1] || null }),
  },
  thead: { ignore: true },
  tbody: { ignore: true },
  s: { mark: "strike" },
  math_inline: {
    node: "math_inline",
    getAttrs: (t) => ({ latex: t.meta.latex }),
  },
  footnote_ref: {
    node: "footnote_ref",
    getAttrs: (t) => ({ label: t.meta.label }),
  },
  math_block: { block: "math_block", noCloseToken: true },
  raw_block: {
    block: "raw_block",
    noCloseToken: true,
    getAttrs: (t) => ({ kind: t.meta?.kind || "html" }),
  },
  html_block: { block: "raw_block", noCloseToken: true },
  html_inline: { node: "raw_inline", getAttrs: (t) => ({ html: t.content }) },
  highlight: { mark: "highlight" },
});
// markdown-it的HTML内联token使用文本节点保留标签，而非执行用户脚本。
(markdownParser as any).tokenHandlers.html_inline = (
  state: any,
  token: Token,
) => {
  const mark = /^<(\/?)(mark|u)>$/i.exec(token.content);
  if (mark) {
    const type =
      schema.marks[mark[2].toLowerCase() === "u" ? "underline" : "highlight"];
    if (mark[1]) state.closeMark(type);
    else state.openMark(type.create());
  } else if (/^<br\s*\/?>$/i.test(token.content))
    state.addNode(schema.nodes.hard_break, null);
  else state.addNode(schema.nodes.raw_inline, { html: token.content });
};

export const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    bullet_list: (s, n) => s.renderList(n, "  ", () => "- "),
    list_item(s, n) {
      if (n.attrs.checked !== null) s.write(n.attrs.checked ? "[x] " : "[ ] ");
      s.renderContent(n);
    },
    raw_inline: (s, n) => s.write(n.attrs.html),
    math_inline: (s, n) => s.write(`$${n.attrs.latex}$`),
    footnote_ref: (s, n) => s.write(`[^${n.attrs.label}]`),
    math_block(s, n) {
      s.write("$$\n");
      s.text(n.textContent, false);
      s.write("\n$$");
      s.closeBlock(n);
    },
    raw_block(s, n) {
      s.text(n.textContent, false);
      s.closeBlock(n);
    },
    table(s, n) {
      const rows: string[][] = [];
      n.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          const text = markdownSerializer
            .serialize(schema.nodes.doc.create(null, cell.content))
            .trim()
            .replace(/\n\s*\n/g, "<br>")
            .replace(/\n/g, "<br>")
            .replace(/\|/g, "\\|");
          cells.push(text);
        });
        rows.push(cells);
      });
      rows.forEach((row, i) => {
        s.write(`| ${row.join(" | ")} |\n`);
        if (i === 0) {
          const aligns: string[] = [];
          n.firstChild!.forEach((cell) =>
            aligns.push(
              cell.attrs.align === "center"
                ? ":---:"
                : cell.attrs.align === "right"
                  ? "---:"
                  : cell.attrs.align === "left"
                    ? ":---"
                    : "---",
            ),
          );
          s.write(`| ${aligns.join(" | ")} |\n`);
        }
      });
      s.closeBlock(n);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strike: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    highlight: { open: "==", close: "==", mixable: true },
    underline: { open: "<u>", close: "</u>", mixable: true },
  },
);
export function parseMarkdown(text: string): PMNode {
  return markdownParser.parse(text);
}
export function serializeMarkdown(doc: PMNode): string {
  return (
    markdownSerializer.serialize(doc, { tightLists: true }) +
    (doc.textContent || doc.childCount > 1 ? "\n" : "")
  );
}
