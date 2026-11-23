import { EditorState, Plugin, TextSelection, Command } from "prosemirror-state";
import {
  EditorView,
  Decoration,
  DecorationSet,
  NodeView,
} from "prosemirror-view";
import { Node as PMNode, Slice } from "prosemirror-model";
import { keymap } from "prosemirror-keymap";
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
  chainCommands,
  exitCode,
  lift,
  selectAll,
} from "prosemirror-commands";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import {
  inputRules,
  InputRule,
  wrappingInputRule,
  textblockTypeInputRule,
  undoInputRule,
} from "prosemirror-inputrules";
import {
  wrapInList,
  splitListItem,
  sinkListItem,
  liftListItem,
} from "prosemirror-schema-list";
import {
  tableEditing,
  columnResizing,
  goToNextCell,
  addRowAfter,
  addRowBefore,
  addColumnAfter,
  addColumnBefore,
  deleteRow,
  deleteColumn,
  deleteTable,
  setCellAttr,
} from "prosemirror-tables";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import { schema, parseMarkdown, serializeMarkdown } from "./schema";
import { headingIDs, resolveResource, getResourceVersion } from "./resources";
import { renderDiagram } from "./visual_blocks";
import { serializeClipboardText } from "./clipboard";
export interface Heading {
  text: string;
  level: number;
  pos: number;
  id: string;
}
export class RichEditor {
  readonly view: EditorView;
  private uploadGeneration = 0;
  private uploads = new Map<
    string,
    {
      bookmark: import("prosemirror-state").SelectionBookmark;
      promise: Promise<void>;
    }
  >();
  get hasPendingUploads(): boolean {
    return this.uploads.size > 0;
  }
  async waitForUploads(): Promise<void> {
    await Promise.all(
      [...this.uploads.values()].map((upload) => upload.promise),
    );
  }
  private query = "";
  private matchCase = false;
  private matches: { from: number; to: number }[] = [];
  private codeViews = new Set<CodeView>();
  private highlightCache = new Map<
    string,
    { from: number; to: number; class: string }[]
  >();
  onMathEdit: ((pos: number, latex: string) => void) | null = null;
  onLink: ((href: string) => void) | null = null;
  constructor(
    host: HTMLElement,
    private onChange: () => void,
    private onSelection: () => void,
  ) {
    this.view = new EditorView(host, {
      state: this.makeState(""),
      attributes: {
        "aria-label": "Markdown正文",
        spellcheck: "false",
        "data-placeholder": "开始写作…",
      },
      dispatchTransaction: (tr) => {
        for (const upload of this.uploads.values())
          upload.bookmark = upload.bookmark.map(tr.mapping);
        this.view.updateState(this.view.state.apply(tr));
        this.updateCodeSelection();
        if (tr.docChanged) this.onChange();
        this.onSelection();
        if (
          tr.selectionSet &&
          document.getElementById("app")?.classList.contains("typewriter-mode")
        ) {
          const pos = this.view.coordsAtPos(this.view.state.selection.head),
            scroller = document.getElementById("writing-pane")!;
          scroller.scrollBy({
            top:
              pos.top -
              scroller.getBoundingClientRect().top -
              scroller.clientHeight * 0.43,
          });
        }
      },
      clipboardTextSerializer: (slice, view) =>
        serializeClipboardText(slice, view.state.selection),
      handlePaste: (view, event) => {
        const images = Array.from(event.clipboardData?.files || []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (images.length) {
          this.importImages(images);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain") || "";
        if (view.state.selection.$from.parent.type.spec.code || !text)
          return false;
        const html = event.clipboardData?.getData("text/html");
        if (
          !html ||
          /(^|\n)(#{1,6} |```|\|.+\||- \[[ xX]\])|\*\*[^*]+\*\*/.test(text)
        ) {
          view.dispatch(
            view.state.tr
              .replaceSelection(new Slice(parseMarkdown(text).content, 0, 0))
              .scrollIntoView(),
          );
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const images = Array.from(event.dataTransfer?.files || []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (!images.length) return false;
        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        this.importImages(images, position?.pos);
        return true;
      },
      handleKeyDown: (view, event) => this.specialKeys(view, event),
      handleClickOn: (_view, _pos, node, nodePos, event) => {
        if (node.type.name === "math_inline") {
          this.onMathEdit?.(nodePos, node.attrs.latex);
          return true;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.target instanceof Element
        ) {
          const a = event.target.closest("a");
          if (a) {
            this.onLink?.(a.getAttribute("href") || "");
            return true;
          }
        }
        return false;
      },
      nodeViews: {
        list_item: (n, v, p) => new TaskView(n, v, p),
        image: (n) => new ImageView(n),
        code_block: (n, v, p) => {
          const cv = new CodeView(n, v, p, false, () =>
            this.codeViews.delete(cv),
          );
          this.codeViews.add(cv);
          return cv;
        },
        math_block: (n, v, p) => {
          const cv = new CodeView(n, v, p, true, () =>
            this.codeViews.delete(cv),
          );
          this.codeViews.add(cv);
          return cv;
        },
        math_inline: (n) => {
          const dom = document.createElement("span");
          dom.className = "inline-math";
          dom.contentEditable = "false";
          dom.dataset.math = n.attrs.latex;
          dom.innerHTML = katex.renderToString(n.attrs.latex, {
            throwOnError: false,
            strict: false,
          });
          return { dom };
        },
      },
    });
  }
  private makeState(text: string): EditorState {
    const rules = [
      wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
      wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list, {
        tight: true,
      }),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        schema.nodes.ordered_list,
        (m) => ({ order: +m[1], tight: true }),
        (m, n) => n.childCount + n.attrs.order === +m[1],
      ),
      textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (m) => ({
        level: m[1].length,
      })),
      new InputRule(/^\[([ xX])\]\s$/, (state, m, start, end) => {
        const p = state.doc.resolve(start);
        for (let d = p.depth; d > 0; d--)
          if (p.node(d).type === schema.nodes.list_item)
            return state.tr
              .delete(start, end)
              .setNodeMarkup(p.before(d), undefined, { checked: m[1] !== " " });
        return null;
      }),
    ];
    for (const [pattern, name] of [
      [/\*\*([^*]+)\*\*$/, "strong"],
      [/(?:^|[^*])\*([^*]+)\*$/, "em"],
      [/~~([^~]+)~~$/, "strike"],
      [/==([^=]+)==$/, "highlight"],
      [/`([^`]+)`$/, "code"],
    ] as const)
      rules.push(
        new InputRule(pattern, (state, m, start, end) => {
          if (state.selection.$from.parent.type.spec.code) return null;
          const mark = schema.marks[name];
          const previous = (state.storedMarks || state.selection.$from.marks()).filter(item => item.type !== mark);
          const prefix = name === "em" && !m[0].startsWith("*") ? 1 : 0;
          return state.tr.replaceWith(start + prefix, end, schema.text(m[1], mark.create().addToSet(previous))).setStoredMarks(previous);
        }),
      );
    rules.push(
      new InputRule(/\$([^$\n]+)\$$/, (s, m, a, b) =>
        s.tr.replaceWith(
          a,
          b,
          schema.nodes.math_inline.create({ latex: m[1] }),
        ),
      ),
    );
    rules.push(
      new InputRule(/!\[([^\]]*)\]\(([^\s)]+)\)$/, (s, m, a, b) =>
        s.tr.replaceWith(
          a,
          b,
          schema.nodes.image.create({ alt: m[1], src: m[2] }),
        ),
      ),
    );
    rules.push(
      new InputRule(/\[([^\]]+)\]\(([^\s)]+)\)$/, (s, m, a, b) =>
        s.tr.replaceWith(
          a,
          b,
          schema.text(m[1], [schema.marks.link.create({ href: m[2] })]),
        ),
      ),
    );
    const keys: Record<string, Command> = {
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      Backspace: undoInputRule,
      "Mod-b": toggleMark(schema.marks.strong),
      "Mod-u": toggleMark(schema.marks.underline),
      "Mod-i": toggleMark(schema.marks.em),
      "Mod-e": toggleMark(schema.marks.code),
      "Shift-Mod-x": toggleMark(schema.marks.strike),
      "Mod-Enter": exitCode,
      Enter: (state, dispatch) => {
        const p = state.selection.$from;
        for (let d = p.depth; d > 0; d--)
          if (p.node(d).type === schema.nodes.list_item)
            return splitListItem(
              schema.nodes.list_item,
              p.node(d).attrs.checked === null ? undefined : { checked: false },
            )(state, dispatch);
        return false;
      },
      Tab: chainCommands(goToNextCell(1), sinkListItem(schema.nodes.list_item)),
      "Shift-Tab": chainCommands(
        goToNextCell(-1),
        liftListItem(schema.nodes.list_item),
      ),
      "Mod-[": liftListItem(schema.nodes.list_item),
      "Mod-]": sinkListItem(schema.nodes.list_item),
    };
    for (let level = 1; level <= 6; level++)
      keys[`Mod-${level}`] = setBlockType(schema.nodes.heading, { level });
    keys["Mod-0"] = setBlockType(schema.nodes.paragraph);
    return EditorState.create({
      schema,
      doc: parseMarkdown(text),
      plugins: [
        inputRules({ rules }),
        keymap(keys),
        keymap(baseKeymap),
        history(),
        columnResizing(),
        dropCursor(),
        gapCursor(),
        new Plugin({
          props: { decorations: (state) => this.decorations(state) },
        }),
        tableEditing(),
      ],
    });
  }
  load(text: string, preserveHistory = false): void {
    this.highlightCache.clear();
    if (!preserveHistory) {
      this.uploadGeneration++;
      this.uploads.clear();
    }
    if (preserveHistory)
      this.view.dispatch(
        closeHistory(
          this.view.state.tr.replaceWith(
            0,
            this.view.state.doc.content.size,
            parseMarkdown(text).content,
          ),
        ),
      );
    else this.view.updateState(this.makeState(text));
    this.updateCodeSelection();
    this.onSelection();
  }
  private importImages(files: File[], position?: number): void {
    const generation = this.uploadGeneration;
    for (const file of files) {
      const id = crypto.randomUUID();
      const selection =
        position === undefined
          ? this.view.state.selection
          : TextSelection.near(this.view.state.doc.resolve(position));
      const bookmark = selection.getBookmark();
      const promise = new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })
        .then((src) => {
          const upload = this.uploads.get(id);
          if (!upload || generation !== this.uploadGeneration) return;
          this.uploads.delete(id);
          const state = this.view.state,
            caret = state.selection.getBookmark();
          const tr = state.tr
            .setSelection(upload.bookmark.resolve(state.doc))
            .replaceSelectionWith(
              schema.nodes.image.create({ src, alt: file.name }),
            );
          tr.setSelection(caret.map(tr.mapping).resolve(tr.doc));
          this.view.dispatch(tr);
        })
        .catch(() => {
          if (generation !== this.uploadGeneration) return;
          this.uploads.delete(id);
          this.onChange();
          const toast = document.getElementById("toast");
          if (toast) {
            toast.textContent = "图片导入失败，请重试";
            toast.hidden = false;
            setTimeout(() => (toast.hidden = true), 2800);
          }
        });
      this.uploads.set(id, { bookmark, promise });
      this.onChange();
    }
  }
  refreshVisuals(): void { for (const view of this.codeViews) view.refresh(); }
  refreshResources(): void {
    this.view.dispatch(
      this.view.state.tr.setMeta("resources", getResourceVersion()),
    );
  }
  markdown(): string {
    return serializeMarkdown(this.view.state.doc);
  }
  focus(): void {
    this.view.focus();
  }
  headings(): Heading[] {
    const result: Heading[] = [];
    this.view.state.doc.descendants((n, pos) => {
      if (n.type.name === "heading")
        result.push({
          text: n.textContent || "未命名标题",
          level: n.attrs.level,
          pos,
          id: "",
        });
    });
    const ids = headingIDs(result.map((h) => h.text));
    result.forEach((h, i) => (h.id = ids[i]));
    return result;
  }
  jump(pos: number): void {
    this.view.dispatch(
      this.view.state.tr
        .setSelection(
          TextSelection.near(
            this.view.state.doc.resolve(
              Math.min(pos + 1, this.view.state.doc.content.size),
            ),
          ),
        )
        .scrollIntoView(),
    );
    this.focus();
  }
  run(command: string, data: Record<string, any> = {}): boolean {
    const { state, dispatch } = this.view;
    const commands: Record<string, Command> = {
      undo,
      redo,
      underline: toggleMark(schema.marks.underline),
      bold: toggleMark(schema.marks.strong),
      italic: toggleMark(schema.marks.em),
      strike: toggleMark(schema.marks.strike),
      code: toggleMark(schema.marks.code),
      highlight: toggleMark(schema.marks.highlight),
      paragraph: setBlockType(schema.nodes.paragraph),
      quote: wrapIn(schema.nodes.blockquote),
      bullet: wrapInList(schema.nodes.bullet_list, { tight: true }),
      ordered: wrapInList(schema.nodes.ordered_list, { tight: true }),
      codeblock: setBlockType(schema.nodes.code_block, {
        params: data.language || "",
      }),
      lift,
      selectAll,
      "table.rowAfter": addRowAfter,
      "table.rowBefore": addRowBefore,
      "table.columnAfter": addColumnAfter,
      "table.columnBefore": addColumnBefore,
      "table.deleteRow": deleteRow,
      "table.deleteColumn": deleteColumn,
      "table.delete": deleteTable,
      "table.left": setCellAttr("align", "left"),
      "table.center": setCellAttr("align", "center"),
      "table.right": setCellAttr("align", "right"),
    };
    let handled = false;
    if (command === "headingUp" || command === "headingDown") {
      const level = state.selection.$from.parent.attrs.level || 0;
      handled = setBlockType(schema.nodes.heading, {
        level: Math.max(
          1,
          Math.min(6, level + (command === "headingUp" ? -1 : 1)),
        ),
      })(state, dispatch);
    } else if (/^heading[1-6]$/.test(command))
      handled = setBlockType(schema.nodes.heading, {
        level: +command.slice(-1),
      })(state, dispatch);
    else if (commands[command])
      handled = commands[command](state, dispatch, this.view);
    else if (command === "table")
      handled = this.insertTable(data.rows || 3, data.cols || 3);
    else if (command === "task") {
      const p = state.selection.$from;
      for (let d = p.depth; d > 0; d--)
        if (p.node(d).type === schema.nodes.list_item) {
          dispatch(
            state.tr.setNodeMarkup(p.before(d), undefined, {
              checked:
                p.node(d).attrs.checked === null
                  ? false
                  : !p.node(d).attrs.checked,
            }),
          );
          handled = true;
          break;
        }
      if (
        !handled &&
        wrapInList(schema.nodes.bullet_list, { tight: true })(state, dispatch)
      )
        return this.run("task");
    } else if (command === "hr") {
      dispatch(
        state.tr
          .replaceSelectionWith(schema.nodes.horizontal_rule.create())
          .scrollIntoView(),
      );
      handled = true;
    } else if (command === "link") {
      if (!state.selection.empty)
        dispatch(
          data.href
            ? state.tr.addMark(
                state.selection.from,
                state.selection.to,
                schema.marks.link.create({
                  href: data.href,
                  title: data.title || null,
                }),
              )
            : state.tr.removeMark(
                state.selection.from,
                state.selection.to,
                schema.marks.link,
              ),
        );
      else if (data.href)
        dispatch(
          state.tr.replaceSelectionWith(
            schema.text(data.text || data.href, [
              schema.marks.link.create({ href: data.href }),
            ]),
          ),
        );
      handled = true;
    } else if (command === "image") {
      dispatch(
        state.tr
          .replaceSelectionWith(
            schema.nodes.image.create({
              src: data.src,
              alt: data.alt || "",
              title: data.title || null,
            }),
          )
          .scrollIntoView(),
      );
      handled = true;
    } else if (command === "math") {
      const n = schema.nodes.math_inline.create({
        latex: data.latex || "E=mc^2",
      });
      dispatch(
        typeof data.pos === "number"
          ? state.tr.replaceWith(
              data.pos,
              data.pos + state.doc.nodeAt(data.pos)!.nodeSize,
              n,
            )
          : state.tr.replaceSelectionWith(n),
      );
      handled = true;
    } else if (command === "mathblock") {
      dispatch(
        state.tr
          .replaceSelectionWith(
            schema.nodes.math_block.create(
              null,
              schema.text(data.latex || "E=mc^2"),
            ),
          )
          .scrollIntoView(),
      );
      handled = true;
    } else if (command === "mermaid") {
      dispatch(
        state.tr
          .replaceSelectionWith(
            schema.nodes.code_block.create(
              { params: "mermaid" },
              schema.text("graph LR\n  A[开始] --> B[完成]"),
            ),
          )
          .scrollIntoView(),
      );
      handled = true;
    }
    this.focus();
    return handled;
  }
  insertTable(rows: number, cols: number, headers?: string[]): boolean {
    rows = Math.max(2, Math.min(30, rows));
    cols = Math.max(1, Math.min(12, cols));
    const nodes = Array.from({ length: rows }, (_, r) =>
      schema.nodes.table_row.create(
        null,
        Array.from({ length: cols }, (_, c) =>
          (r === 0
            ? schema.nodes.table_header
            : schema.nodes.table_cell
          ).create(
            null,
            schema.nodes.paragraph.create(
              null,
              r === 0 && headers?.[c] ? schema.text(headers[c]) : null,
            ),
          ),
        ),
      ),
    );
    this.view.dispatch(
      this.view.state.tr
        .replaceSelectionWith(schema.nodes.table.create(null, nodes))
        .scrollIntoView(),
    );
    return true;
  }
  private specialKeys(view: EditorView, e: KeyboardEvent): boolean {
    if (
      e.isComposing ||
      view.composing ||
      e.key !== "Enter" ||
      e.shiftKey ||
      e.metaKey ||
      e.ctrlKey
    )
      return false;
    const { $from: p, empty } = view.state.selection;
    if (!empty || p.parent.type.name !== "paragraph") return false;
    const text = p.parent.textContent,
      fence = /^```([\w+-]*)$/.exec(text);
    if (fence || text === "$$" || /^(---|\*\*\*|___)$/.test(text)) {
      const node = fence
        ? schema.nodes.code_block.create({ params: fence[1] })
        : text === "$$"
          ? schema.nodes.math_block.create()
          : schema.nodes.horizontal_rule.create();
      let tr = view.state.tr.replaceWith(p.before(), p.after(), node);
      if (node.isTextblock)
        tr = tr.setSelection(TextSelection.create(tr.doc, p.before() + 1));
      view.dispatch(tr.scrollIntoView());
      return true;
    }
    if (/^\|.+\|$/.test(text)) {
      const headers = text
        .slice(1, -1)
        .split("|")
        .map((s) => s.trim());
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, p.start(), p.end()),
        ),
      );
      return this.insertTable(2, headers.length, headers);
    }
    return false;
  }
  search(query: string, matchCase = false): number {
    this.query = query;
    this.matchCase = matchCase;
    this.view.dispatch(this.view.state.tr.setMeta("search", true));
    return this.matches.length;
  }
  nextMatch(backward = false): { index: number; total: number } {
    if (!this.matches.length) return { index: 0, total: 0 };
    const { to } = this.view.state.selection;
    let index = backward
      ? this.matches.map((m) => m.to < to).lastIndexOf(true)
      : this.matches.findIndex((m) => m.from >= to);
    if (index < 0) index = backward ? this.matches.length - 1 : 0;
    const m = this.matches[index];
    this.view.dispatch(
      this.view.state.tr
        .setSelection(TextSelection.create(this.view.state.doc, m.from, m.to)),
    );
    // 搜索框持有焦点时，ProseMirror会忽略编辑器外的DOM选区，默认
    // scrollIntoView事务不能保证滚动。直接定位当前高亮，兼顾长代码行。
    this.view.dom.querySelector<HTMLElement>(".search-match.current")?.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
    return { index: index + 1, total: this.matches.length };
  }
  replace(replacement: string, all = false): number {
    const tr = this.view.state.tr;
    let count = 0;
    if (all)
      for (const m of [...this.matches].reverse()) {
        tr.insertText(replacement, m.from, m.to);
        count++;
      }
    else {
      const { from, to } = this.view.state.selection;
      if (this.matches.some((m) => m.from === from && m.to === to)) {
        tr.insertText(replacement, from, to);
        count = 1;
      }
    }
    if (count) this.view.dispatch(tr);
    return count;
  }
  private decorations(state: EditorState): DecorationSet {
    const decos: Decoration[] = [];
    this.matches = [];
    const headings: { text: string; pos: number; size: number }[] = [];
    state.doc.descendants((n, pos) => {
      if (n.type.name === "heading")
        headings.push({ text: n.textContent, pos, size: n.nodeSize });
    });
    const ids = headingIDs(headings.map((h) => h.text));
    headings.forEach((h, i) =>
      decos.push(Decoration.node(h.pos, h.pos + h.size, { id: ids[i] })),
    );
    const { $from, from, to, empty } = state.selection,
      activePos = $from.depth ? $from.before(1) : -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "image")
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, {
            "data-resource-version": String(getResourceVersion()),
          }),
        );
      if (node.isBlock && pos === activePos) {
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, { class: "active-block" }),
        );
        if (node.type.name === "heading" && empty)
          decos.push(
            Decoration.widget(
              pos + 1,
              () => {
                const marker = document.createElement("span");
                marker.textContent = "#".repeat(node.attrs.level);
                marker.className = "syntax-marker heading-marker";
                marker.contentEditable = "false";
                return marker;
              },
              { side: -1, key: `heading-${pos}` },
            ),
          );
      }
      if (node.type.name === "paragraph" && node.content.size === 0)
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "empty-paragraph",
          }),
        );
      if (node.isText && this.query) {
        const text = this.matchCase
            ? node.text!
            : node.text!.toLocaleLowerCase(),
          q = this.matchCase ? this.query : this.query.toLocaleLowerCase();
        let index = 0;
        while ((index = text.indexOf(q, index)) >= 0) {
          const m = { from: pos + index, to: pos + index + q.length };
          this.matches.push(m);
          decos.push(
            Decoration.inline(m.from, m.to, {
              class:
                from === m.from && to === m.to
                  ? "search-match current"
                  : "search-match",
            }),
          );
          index += q.length;
        }
      }
      if (
        node.type.name === "code_block" &&
        node.attrs.params &&
        hljs.getLanguage(node.attrs.params)
      ) {
        const key = `${node.attrs.params}:${node.textContent}`;
        let spans = this.highlightCache.get(key);
        if (!spans) {
          const dom = document.createElement("div");
          dom.innerHTML = hljs.highlight(node.textContent, {
            language: node.attrs.params,
            ignoreIllegals: true,
          }).value;
          spans = [];
          let offset = 0;
          const walk = (el: Node, classes: string) => {
            if (el.nodeType === Node.TEXT_NODE) {
              const length = el.textContent?.length || 0;
              if (classes && length)
                spans!.push({
                  from: offset,
                  to: offset + length,
                  class: classes,
                });
              offset += length;
            } else
              el.childNodes.forEach((child) =>
                walk(
                  child,
                  el instanceof Element
                    ? `${classes} ${el.className}`.trim()
                    : classes,
                ),
              );
          };
          walk(dom, "");
          if (this.highlightCache.size > 100) this.highlightCache.clear();
          this.highlightCache.set(key, spans);
        }
        for (const span of spans)
          decos.push(
            Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, {
              class: span.class,
            }),
          );
      }
    });
    return DecorationSet.create(state.doc, decos);
  }
  private updateCodeSelection(): void {
    for (const cv of this.codeViews) cv.selectionChanged();
  }
}
class TaskView implements NodeView {
  dom = document.createElement("li");
  contentDOM = document.createElement("div");
  private checkbox = document.createElement("input");
  constructor(
    private node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.checkbox.type = "checkbox";
    this.checkbox.contentEditable = "false";
    this.checkbox.setAttribute("aria-label", "任务完成状态");
    this.checkbox.addEventListener("mousedown", (e) => e.preventDefault());
    this.checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      const pos = getPos();
      if (pos !== undefined)
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, {
            checked: !this.node.attrs.checked,
          }),
        );
    });
    this.dom.append(this.checkbox, this.contentDOM);
    this.update(node);
  }
  update(n: PMNode): boolean {
    if (n.type.name !== "list_item") return false;
    this.node = n;
    this.checkbox.hidden = n.attrs.checked === null;
    this.checkbox.checked = !!n.attrs.checked;
    this.dom.classList.toggle("task-item", n.attrs.checked !== null);
    this.dom.dataset.checked =
      n.attrs.checked === null ? "" : String(n.attrs.checked);
    return true;
  }
  stopEvent(e: Event): boolean {
    return e.target === this.checkbox;
  }
  ignoreMutation(m: any): boolean {
    return (
      m.target === this.checkbox ||
      (m.type === "attributes" && m.target === this.dom)
    );
  }
}
class ImageView implements NodeView {
  dom = document.createElement("span");
  private image = document.createElement("img");
  private caption = document.createElement("span");
  private version = -1;
  constructor(node: PMNode) {
    this.dom.className = "image-wrapper";
    this.dom.contentEditable = "false";
    this.caption.className = "image-error";
    this.dom.append(this.image, this.caption);
    this.image.onerror = () => {
      this.caption.hidden = false;
      this.caption.textContent = `图片无法读取：${this.image.dataset.source}`;
    };
    this.image.onload = () => {
      this.caption.hidden = true;
    };
    this.update(node);
  }
  update(n: PMNode): boolean {
    if (n.type.name !== "image") return false;
    if (
      this.image.dataset.source !== n.attrs.src ||
      this.version !== getResourceVersion()
    ) {
      this.version = getResourceVersion();
      this.image.dataset.source = n.attrs.src;
      this.image.src = resolveResource(n.attrs.src);
    }
    this.image.alt = n.attrs.alt || "";
    this.image.title = n.attrs.title || "";
    this.caption.hidden = true;
    return true;
  }
  ignoreMutation(): boolean {
    return true;
  }
}
class CodeView implements NodeView {
  dom = document.createElement("div");
  contentDOM = document.createElement("code");
  private pre = document.createElement("pre");
  private visual = document.createElement("div");
  private language = document.createElement("input");
  private rendered = "";
  private generation = 0;
  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private math: boolean,
    private onDestroy: () => void,
  ) {
    this.dom.className = math ? "visual-block math-block" : "code-block";
    this.pre.append(this.contentDOM);
    this.visual.className = "visual-result";
    this.visual.contentEditable = "false";
    this.language.className = "code-language";
    this.language.setAttribute("aria-label", "代码语言");
    this.language.placeholder = "选择语言";
    this.language.contentEditable = "false";
    this.language.hidden = math;
    this.language.onchange = () => {
      const pos = this.getPos();
      if (pos !== undefined)
        this.view.dispatch(
          this.view.state.tr.setNodeMarkup(pos, undefined, {
            params: this.language.value.trim(),
          }),
        );
      this.view.focus();
    };
    this.visual.onclick = () => {
      const pos = this.getPos();
      if (pos !== undefined) {
        this.view.dispatch(
          this.view.state.tr.setSelection(
            TextSelection.create(this.view.state.doc, pos + 1),
          ),
        );
        this.view.focus();
      }
    };
    this.dom.append(this.pre, this.visual, this.language);
    this.update(node);
  }
  update(n: PMNode): boolean {
    if (n.type !== this.node.type) return false;
    this.node = n;
    this.language.value = n.attrs.params || "";
    const diagram =
      !this.math && n.attrs.params?.trim().toLowerCase() === "mermaid";
    this.dom.classList.toggle("visual-block", this.math || diagram);
    this.visual.hidden = !this.math && !diagram;
    if (
      (this.math || diagram) &&
      this.rendered !== `${n.attrs.params}:${n.textContent}`
    ) {
      this.rendered = `${n.attrs.params}:${n.textContent}`;
      const generation = ++this.generation;
      this.visual.classList.remove("diagram-error");
      if (this.math)
        this.visual.innerHTML = katex.renderToString(
          n.textContent || "\\text{数学公式}",
          { displayMode: true, throwOnError: false, strict: false },
        );
      else
        renderDiagram(n.textContent)
          .then((svg) => {
            if (generation === this.generation) this.visual.innerHTML = svg;
          })
          .catch(() => {
            if (generation === this.generation) {
              this.visual.textContent = "图表语法有误，点击编辑";
              this.visual.classList.add("diagram-error");
            }
          });
    }
    this.selectionChanged();
    return true;
  }
  refresh(): void { this.rendered = ""; this.visual.classList.remove("diagram-error"); this.update(this.node); }
  selectionChanged(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const s = this.view.state.selection;
    this.dom.classList.toggle(
      "is-editing",
      s.from >= pos && s.to <= pos + this.node.nodeSize,
    );
  }
  stopEvent(e: Event): boolean {
    return e.target === this.language || this.visual.contains(e.target as Node);
  }
  ignoreMutation(m: any): boolean {
    return (
      this.visual.contains(m.target) ||
      m.target === this.visual ||
      m.target === this.language ||
      (m.type === "attributes" && m.target === this.dom)
    );
  }
  destroy(): void {
    this.generation++;
    this.onDestroy();
  }
}
