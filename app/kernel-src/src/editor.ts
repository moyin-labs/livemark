import { EditorView as SourceView, basicSetup } from "codemirror";
import { undo as sourceUndo, redo as sourceRedo, selectAll as sourceSelectAll } from "@codemirror/commands";
import {
  EditorState as SourceState,
  Transaction as SourceTransaction,
  Compartment,
} from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import {
  syntaxHighlighting,
  HighlightStyle,
  Language,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { RichEditor, Heading } from "./rich_editor";
import { TextSelection } from "prosemirror-state";
import { parseMarkdown } from "./schema";
import { headingIDs, getDocumentLanguage } from "./resources";
export type EditorMode = "live" | "source" | "preview";
let rich: RichEditor;
let source: SourceView;
let savedDocument = parseMarkdown("");
let text = "",
  savedText = "",
  suppress = false,
  mode: EditorMode = "live";
let contentChanged: (dirty: boolean) => void = () => {};
let selectionChanged: () => void = () => {};
let revision = 0;
const sourceEditable = new Compartment();
const sourceLanguage = new Compartment();
const jsLanguage = javascript().language;
const tsLanguage = javascript({ typescript: true }).language;
const sourceLanguages: Record<string, Language> = {
  javascript: jsLanguage,
  js: jsLanguage,
  typescript: tsLanguage,
  ts: tsLanguage,
  jsx: javascript({ jsx: true }).language,
  tsx: javascript({ typescript: true, jsx: true }).language,
  python: python().language,
  py: python().language,
  json: json().language,
  css: css().language,
  html: html().language,
};
const sourceHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: "var(--syntax-keyword)" },
    { tag: tags.string, color: "var(--syntax-string)" },
    { tag: tags.number, color: "var(--syntax-number)" },
    { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
    { tag: tags.heading, color: "var(--fg)", fontWeight: "600" },
    { tag: tags.link, color: "var(--accent)" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.function(tags.variableName), color: "var(--accent)" },
  ]),
);
function sourceSyntax() {
  const language = getDocumentLanguage();
  if (language === "json") return json();
  if (language !== null) return [];
  return markdown({
    addKeymap: true,
    codeLanguages: (name) =>
      sourceLanguages[name.trim().split(/\s+/)[0].toLowerCase()] || null,
  });
}
const sourceExtensions = () => [
  basicSetup,
  sourceEditable.of(SourceView.editable.of(true)),
  sourceLanguage.of(sourceSyntax()),
  sourceHighlight,
  SourceView.lineWrapping,
  SourceView.theme({
    "&": { height: "100%", color: "var(--fg)", background: "transparent" },
    ".cm-scroller": { fontFamily: "var(--code-font)", lineHeight: "1.7" },
    ".cm-content": { padding: "36px 0 120px" },
    ".cm-gutters": {
      background: "transparent",
      color: "var(--muted)",
      border: "none",
    },
    "&.cm-focused": { outline: "none" },
  }),
  SourceView.updateListener.of((update) => {
    if (update.docChanged && !suppress) {
      text = update.state.doc.toString();
      revision++;
      contentChanged(text !== savedText || rich.hasPendingUploads);
    }
    if (!suppress && (update.docChanged || update.selectionSet))
      selectionChanged();
  }),
];
export function mountEditor(
  onChange: (dirty: boolean) => void,
  onSelection: () => void,
): RichEditor {
  contentChanged = onChange;
  selectionChanged = onSelection;
  rich = new RichEditor(
    document.getElementById("rich-host")!,
    () => {
      if (!suppress) {
        text = rich.view.state.doc.eq(savedDocument)
          ? savedText
          : rich.markdown();
        revision++;
        contentChanged(text !== savedText || rich.hasPendingUploads);
      }
    },
    () => selectionChanged(),
  );
  source = new SourceView({
    state: SourceState.create({ doc: "", extensions: sourceExtensions() }),
    parent: document.getElementById("cm-host")!,
  });
  return rich;
}
export function setEditorContent(content: string, preserveView = false): void {
  const caret = rich.view.state.selection.head;
  const sourceSelection = source.state.selection.main;
  const scrolls = Array.from(document.querySelectorAll<HTMLElement>(
    "#writing-pane, #source-pane, #preview-pane, .cm-scroller",
  )).map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  suppress = true;
  text = content;
  savedText = content;
  savedDocument = parseMarkdown(getDocumentLanguage() === null ? content : "");
  revision = 0;
  rich.load(getDocumentLanguage() === null ? content : "");
  source.setState(
    SourceState.create({
      doc: content,
      extensions: sourceExtensions(),
      selection: preserveView ? {
        anchor: Math.min(sourceSelection.anchor, content.length),
        head: Math.min(sourceSelection.head, content.length),
      } : undefined,
    }),
  );
  if (preserveView)
    rich.view.dispatch(rich.view.state.tr.setSelection(TextSelection.near(
      rich.view.state.doc.resolve(Math.min(caret, rich.view.state.doc.content.size)),
    )));
  suppress = false;
  selectionChanged();
  if (preserveView) {
    const restore = () => {
      if (text !== content) return;
      for (const { element, top, left } of scrolls) {
        element.scrollTop = top;
        element.scrollLeft = left;
      }
    };
    restore();
    requestAnimationFrame(restore);
  } else {
    document.getElementById("writing-pane")!.scrollTop = 0;
    focusEditor();
  }
}
export function isEditorComposing(): boolean { return rich.view.composing || source.composing; }
export function setMode(next: EditorMode): void {
  if (getDocumentLanguage() !== null && next === "live") next = "preview";
  if (next === mode || rich.hasPendingUploads) return;
  suppress = true;
  if (getDocumentLanguage() === null && (mode === "source" || next === "live"))
    rich.load(text, true);
  if (next === "source" && source.state.doc.toString() !== text)
    source.dispatch({
      changes: { from: 0, to: source.state.doc.length, insert: text },
      annotations: SourceTransaction.addToHistory.of(false),
    });
  mode = next;
  document.getElementById("app")!.dataset.mode = mode;
  suppress = false;
  selectionChanged();
  requestAnimationFrame(() => {
    source.requestMeasure();
    focusEditor();
  });
}
export function setEditorBusy(busy: boolean): void {
  rich.view.setProps({ editable: () => !busy });
  source.dispatch({
    effects: sourceEditable.reconfigure(SourceView.editable.of(!busy)),
  });
}
export function getMode(): EditorMode {
  return mode;
}
export function refreshDocumentFormat(): void {
  source.dispatch({ effects: sourceLanguage.reconfigure(sourceSyntax()) });
  if (getDocumentLanguage() !== null) setMode("preview");
}
export function getEditorContent(): string {
  return text;
}
export async function waitForImages(): Promise<void> {
  await rich.waitForUploads();
}
export function getRevision(): number {
  return revision;
}
export function markSaved(content: string): void {
  savedText = content;
  savedDocument = parseMarkdown(getDocumentLanguage() === null ? content : "");
  contentChanged(text !== savedText || rich.hasPendingUploads);
}
export function isDirty(): boolean {
  return text !== savedText || rich.hasPendingUploads;
}
export function focusEditor(): void {
  if (mode === "source") source.focus();
  else if (mode === "live") rich.focus();
}
export function getRichEditor(): RichEditor {
  return rich;
}
export function getSelectedText(): string {
  if (mode === "source")
    return source.state.sliceDoc(
      source.state.selection.main.from,
      source.state.selection.main.to,
    );
  return rich.view.state.doc.textBetween(
    rich.view.state.selection.from,
    rich.view.state.selection.to,
  );
}
export function runCommand(
  command: string,
  data: Record<string, any> = {},
): boolean {
  if (command === "selectAll") {
    if (mode === "source") {
      source.focus();
      return sourceSelectAll(source);
    }
    if (mode === "preview") {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("preview")!);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    }
    return rich.run(command, data);
  }
  if (getDocumentLanguage() !== null) {
    if (command !== "undo" && command !== "redo") return false;
    setMode("source");
  }
  if (mode === "source" && (command === "undo" || command === "redo"))
    return (command === "undo" ? sourceUndo : sourceRedo)(source);
  if (mode === "source") {
    const selection = source.state.selection.main,
      selected = source.state.sliceDoc(selection.from, selection.to);
    const delimiters: Record<string, [string, string]> = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      underline: ["<u>", "</u>"],
      strike: ["~~", "~~"],
      code: ["`", "`"],
      highlight: ["==", "=="],
      math: ["$", "$"],
      mathblock: ["$$\n", "\n$$"],
      codeblock: ["```" + (data.language || "") + "\n", "\n```"],
    };
    if (delimiters[command]) {
      const [open, close] = delimiters[command];
      const inner = data.latex || selected;
      source.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: open + inner + close,
        },
        selection: {
          anchor: selection.from + open.length,
          head: selection.from + open.length + inner.length,
        },
      });
      source.focus();
      return true;
    }
    if (/^heading[1-6]$/.test(command) || command === "paragraph") {
      const line = source.state.doc.lineAt(selection.from),
        prefix =
          command === "paragraph" ? "" : "#".repeat(+command.slice(-1)) + " ";
      const old = /^#{1,6}\s+/.exec(line.text)?.[0] || "";
      source.dispatch({
        changes: {
          from: line.from,
          to: line.from + old.length,
          insert: prefix,
        },
      });
      source.focus();
      return true;
    }
    const linePrefixes: Record<string, string> = {
      quote: "> ",
      bullet: "- ",
      ordered: "1. ",
      task: "- [ ] ",
    };
    if (linePrefixes[command]) {
      const first = source.state.doc.lineAt(selection.from),
        last = source.state.doc.lineAt(selection.to);
      source.dispatch({
        changes: {
          from: first.from,
          to: last.to,
          insert: source.state
            .sliceDoc(first.from, last.to)
            .split("\n")
            .map((line) => linePrefixes[command] + line)
            .join("\n"),
        },
      });
      source.focus();
      return true;
    }
    if (
      command === "link" ||
      command === "image" ||
      command === "hr" ||
      command === "table" ||
      command === "mermaid"
    ) {
      const cols = Math.min(12, Math.max(1, data.cols || 3)),
        rows = Math.min(30, Math.max(2, data.rows || 3));
      const table =
        "| " +
        Array(cols).fill("标题").join(" | ") +
        " |\n| " +
        Array(cols).fill("---").join(" | ") +
        " |\n" +
        Array.from(
          { length: rows - 1 },
          () => "| " + Array(cols).fill(" ").join(" | ") + " |",
        ).join("\n");
      const insert =
        command === "link"
          ? `[${selected || data.text || data.href}](${data.href})`
          : command === "image"
            ? `![${data.alt || ""}](${data.src})`
            : command === "hr"
              ? "\n---\n"
              : command === "table"
                ? "\n" + table + "\n"
                : "\n```mermaid\ngraph LR\n A-->B\n```\n";
      source.dispatch(source.state.replaceSelection(insert));
      source.focus();
      return true;
    }
  }
  if (mode !== "live") setMode("live");
  return rich.run(command, data);
}
export function headings(): Heading[] {
  if (getDocumentLanguage() !== null) return [];
  if (mode !== "source") return rich.headings();
  const result: Heading[] = [];
  parseMarkdown(text).descendants((n, pos) => {
    if (n.type.name === "heading")
      result.push({ text: n.textContent, level: n.attrs.level, pos, id: "" });
  });
  headingIDs(result.map((h) => h.text)).forEach((id, i) => (result[i].id = id));
  return result;
}
export function jumpHeading(h: Heading): void {
  if (mode === "source") {
    const lines = text.split("\n");
    let count = 0,
      offset = 0;
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line)) {
        if (count++ === headings().findIndex((item) => item.id === h.id)) break;
      }
      offset += line.length + 1;
    }
    source.dispatch({
      selection: { anchor: Math.min(offset, source.state.doc.length) },
      effects: SourceView.scrollIntoView(
        Math.min(offset, source.state.doc.length),
        { y: "start" },
      ),
    });
    source.focus();
  } else if (mode === "preview")
    document
      .getElementById(`preview-${h.id}`)
      ?.scrollIntoView({ block: "start" });
  else rich.jump(h.pos);
}
