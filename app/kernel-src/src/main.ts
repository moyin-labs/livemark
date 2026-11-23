import { Bridge, KERNEL_VERSION } from "./bridge";
import {
  mountEditor,
  setEditorContent,
  getEditorContent,
  getRevision,
  focusEditor,
  setMode,
  getMode,
  runCommand,
  headings,
  jumpHeading,
  markSaved,
  isDirty,
  isEditorComposing,
  getRichEditor,
  getSelectedText,
  setEditorBusy,
  waitForImages,
  refreshDocumentFormat,
} from "./editor";
import { renderPreview } from "./preview";
import { setupExport } from "./export";
import { setupDocumentWidth } from "./document_width";
import { setupMode } from "./mode";
import { setDocumentPath, getDocumentLanguage } from "./resources";
import type { Heading } from "./rich_editor";
const bridge = new Bridge();
window.__livemark = bridge;
const app = document.getElementById("app")!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
let loading = false,
  previewTimer = 0,
  outlineTimer = 0,
  outlineItems: Heading[] = [],
  docID = "",
  sidebarTab = "outline";
let lastReadID: string | number | undefined;
let lastReportedMode: string | undefined;
const store = {
  get(key: string, fallback = "") {
    try {
      return localStorage.getItem(`livemark.${key}`) || fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`livemark.${key}`, value);
    } catch {}
  },
};
app.classList.toggle(
  "sidebar-hidden",
  store.get("sidebar", "visible") === "hidden",
);
app.style.setProperty(
  "--sidebar-width",
  `${Math.min(400, Math.max(180, +store.get("sidebarWidth", "240")))}px`,
);
const rich = mountEditor(
  (dirty) => {
    if (loading) return;
    bridge.emit("file.contentChanged", {
      dirty,
      revision: getRevision(),
      documentID: docID,
    });
    window.clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(updateOutline, 100);
    if (getMode() === "preview") schedulePreview();
  },
  () => {
    updateStatistics();
    updateActiveHeading();
    $("table-tools").hidden = getMode() !== "live" || !inTable();
  },
);
rich.onMathEdit = (pos, latex) =>
  insertDialog(
    "数学公式",
    [{ key: "latex", label: "LaTeX", value: latex, multiline: true }],
    (data) => runCommand("math", { ...data, pos }),
  );
rich.onLink = openLink;
setupMode(bridge);
setupExport(bridge);
setupDocumentWidth($("rich-host"));
setupDocumentWidth($("preview"));
function schedulePreview(preserveScroll = false) {
  const pane = $("preview-pane");
  const top = pane.scrollTop;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    await renderPreview($("preview"), getEditorContent());
    if (preserveScroll) pane.scrollTop = top;
  }, 80);
}
function updateStatistics() {
  const text = getEditorContent()
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_`>\[\]()!~|]/g, "");
  const chinese =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)
      ?.length || 0;
  const words =
    text
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ")
      .match(/[\p{L}\p{N}]+/gu)?.length || 0;
  $("word-count").textContent = `${chinese + words}字`;
  if (getRichEditor()) {
    const selection = getMode() === "preview" ? "" : getSelectedText();
    $("selection-count").textContent = selection
      ? `选中${selection.length}字符`
      : "";
  }
  const mode = getMode();
  app.dataset.mode = mode;
  $("source-pane").hidden = mode !== "source";
  $("writing-pane").hidden = mode !== "live";
  $("preview-pane").hidden = mode !== "preview";
  if (mode !== lastReportedMode) {
    lastReportedMode = mode;
    bridge.emit("mode.changed", { mode });
  }
}
function inTable(): boolean {
  if (!getRichEditor()) return false;
  const p = rich.view.state.selection.$from;
  for (let d = p.depth; d; d--)
    if (p.node(d).type.name === "table") return true;
  return false;
}
function updateOutline() {
  outlineItems = headings();
  const filter =
    $<HTMLInputElement>("sidebar-search").value.toLocaleLowerCase();
  const nav = $("outline");
  nav.replaceChildren();
  for (const item of outlineItems.filter((h) =>
    h.text.toLocaleLowerCase().includes(filter),
  )) {
    const button = document.createElement("button");
    button.className = "outline-item";
    button.style.setProperty("--level", String(item.level - 1));
    button.textContent = item.text;
    button.dataset.id = item.id;
    button.dataset.level = String(item.level);
    button.onclick = () => jumpHeading(item);
    nav.append(button);
  }
  if (!nav.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = filter ? "没有匹配的标题" : "文档中的标题将显示在这里";
    nav.append(empty);
  }
  updateActiveHeading();
}
function updateActiveHeading() {
  if (!getRichEditor() || !outlineItems.length) return;
  const scrollTop = $("writing-pane").getBoundingClientRect().top + 70;
  let active = outlineItems[0];
  for (const h of outlineItems) {
    const node = rich.view.nodeDOM(h.pos);
    if (
      node instanceof HTMLElement &&
      node.getBoundingClientRect().top <= scrollTop
    )
      active = h;
  }
  if (rich.view.hasFocus()) {
    const pos = rich.view.state.selection.from;
    active = [...outlineItems].reverse().find((h) => h.pos <= pos) || active;
  }
  $("outline")
    .querySelectorAll<HTMLElement>(".outline-item")
    .forEach((b) => {
      b.classList.toggle("active", b.dataset.id === active.id);
      if (b.dataset.id === active.id) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
}
function toggleSidebar() {
  app.classList.toggle("sidebar-hidden");
  store.set(
    "sidebar",
    app.classList.contains("sidebar-hidden") ? "hidden" : "visible",
  );
}
function switchMode(mode: "live" | "source" | "preview") {
  setMode(mode);
  if (getMode() === "preview") schedulePreview();
  updateStatistics();
  updateOutline();
}
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  setTimeout(() => ($("toast").hidden = true), 2800);
}
async function openLink(href: string) {
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1)),
      heading = headings().find((h) => h.id === id);
    if (heading) jumpHeading(heading);
    else toast("未找到对应标题");
  } else if (window.webkit) await bridge.callHandler("file.openLink", { href });
  else if (/^https?:/.test(href)) window.open(href, "_blank", "noopener");
}
$("preview").addEventListener("click", (event) => {
  const a = (event.target as Element).closest("a");
  if (a) {
    event.preventDefault();
    void openLink(a.getAttribute("href") || "");
  }
});
$("writing-pane").onscroll = updateActiveHeading;
$("sidebar-search").oninput = () =>
  sidebarTab === "outline" ? updateOutline() : filterFiles();
function chooseTab(tab: string) {
  sidebarTab = tab;
  $("outline").hidden = tab !== "outline";
  $("files").hidden = tab !== "files";
  ["outline", "files"].forEach((id) => {
    $(`${id}-tab`).classList.toggle("selected", tab === id);
    $(`${id}-tab`).setAttribute("aria-selected", String(tab === id));
  });
  $<HTMLInputElement>("sidebar-search").placeholder =
    tab === "outline" ? "搜索标题" : "搜索文件";
  if (tab === "files") void loadFiles();
}
$("outline-tab").onclick = () => chooseTab("outline");
$("files-tab").onclick = () => chooseTab("files");
function filterFiles() {
  const q = $<HTMLInputElement>("sidebar-search").value.toLocaleLowerCase();
  $("files")
    .querySelectorAll<HTMLElement>("[data-name]")
    .forEach(
      (el) => (el.hidden = !el.dataset.name!.toLocaleLowerCase().includes(q)),
    );
}
async function loadFiles(path?: string, container = $("files")) {
  if (!window.webkit) {
    container.textContent = "通过桌面应用打开文档或文件夹";
    return;
  }
  try {
    const result = await bridge.callHandler("file.list", { path });
    if (container === $("files")) {
      container.replaceChildren();
      container.setAttribute("aria-label", result.name ? `文件树：${result.name}` : "文件树");
    }
    for (const file of result.items || []) {
      const row = document.createElement("button");
      row.className = `file-item ${file.directory ? "directory" : ""}`;
      row.dataset.name = file.name;
      row.textContent = `${file.directory ? "▸" : "▤"}  ${file.name}`;
      row.title = file.path;
      row.classList.toggle("active", file.active);
      row.oncontextmenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        // 原生菜单可能停留较长时间，使用事件避免Bridge请求超时。
        bridge.emit("file.contextMenu", { path: file.path });
      };
      container.append(row);
      if (file.directory) {
        const children = document.createElement("div");
        children.className = "file-children";
        children.hidden = true;
        container.append(children);
        row.onclick = async () => {
          children.hidden = !children.hidden;
          row.textContent = `${children.hidden ? "▸" : "▾"}  ${file.name}`;
          if (!children.childElementCount) await loadFiles(file.path, children);
        };
      } else
        row.onclick = () =>
          bridge
            .callHandler("file.open", { path: file.path })
            .catch(() => toast("文档打开失败"));
    }
    filterFiles();
  } catch {
    toast("无法读取文件夹");
  }
}
const resizer = $("sidebar-resizer");
resizer.onpointerdown = (event) => {
  resizer.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing");
};
resizer.onpointermove = (event) => {
  if (!resizer.hasPointerCapture(event.pointerId)) return;
  const width = Math.max(180, Math.min(420, event.clientX));
  app.style.setProperty("--sidebar-width", `${width}px`);
  store.set("sidebarWidth", String(width));
};
resizer.onpointerup = (event) => {
  resizer.releasePointerCapture(event.pointerId);
  document.body.classList.remove("resizing");
};
resizer.onkeydown = (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const width = Math.max(
    180,
    Math.min(
      420,
      $("sidebar").offsetWidth + (event.key === "ArrowLeft" ? -10 : 10),
    ),
  );
  app.style.setProperty("--sidebar-width", `${width}px`);
  store.set("sidebarWidth", String(width));
};
function showFind(replace = false) {
  if (getMode() !== "live") switchMode("live");
  $("find-bar").hidden = false;
  $("replace-row").hidden = !replace;
  $<HTMLInputElement>("find-input").focus();
  $<HTMLInputElement>("find-input").select();
}
function findNext(back = false) {
  const result = rich.nextMatch(back);
  $("find-count").textContent = `${result.index}/${result.total}`;
  // 导航按钮和连续回车共享入口，保持输入框焦点且不滚回输入框。
  $<HTMLInputElement>("find-input").focus({ preventScroll: true });
}
$("find-bar").onsubmit = (event) => {
  event.preventDefault();
  findNext();
};
$("find-input").onkeydown = (event) => {
  // 多输入框表单不会可靠地隐式提交；显式处理回车，避免跳过或重复跳转。
  // WebKit确认输入法候选词时可能仍报告229，不能把该回车用于导航。
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  event.stopPropagation();
  findNext(event.shiftKey);
};
$("find-input").oninput = () => {
  const total = rich.search(
    $<HTMLInputElement>("find-input").value,
    $<HTMLInputElement>("find-case").checked,
  );
  $("find-count").textContent = `${total}项`;
};
$("find-case").onchange = () =>
  $("find-input").dispatchEvent(new Event("input"));
$("find-next").onclick = () => findNext();
$("find-prev").onclick = () => findNext(true);
$("find-replace-toggle").onclick = () =>
  ($("replace-row").hidden = !$("replace-row").hidden);
$("find-close").onclick = () => {
  $("find-bar").hidden = true;
  rich.search("");
  focusEditor();
};
$("replace-one").onclick = () => {
  if (!rich.replace($<HTMLInputElement>("replace-input").value)) findNext();
  else findNext();
};
$("replace-all").onclick = () => {
  const count = rich.replace($<HTMLInputElement>("replace-input").value, true);
  $("find-count").textContent = `${count}项已替换`;
};
function insertDialog(
  title: string,
  fields: {
    key: string;
    label: string;
    value?: string;
    multiline?: boolean;
    type?: string;
  }[],
  apply: (data: Record<string, string>) => void,
) {
  const dialog = $<HTMLDialogElement>("insert-dialog");
  $("dialog-title").textContent = title;
  $("dialog-fields").replaceChildren();
  fields.forEach((field) => {
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement(
      field.multiline ? "textarea" : "input",
    ) as HTMLInputElement;
    input.name = field.key;
    input.value = field.value || "";
    input.setAttribute("aria-label", field.label);
    if (!field.multiline) input.type = field.type || "text";
    label.append(input);
    $("dialog-fields").append(label);
  });
  $<HTMLFormElement>("insert-form").onsubmit = (event) => {
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement;
    if (submitter?.value !== "cancel") {
      const data = Object.fromEntries(
        new FormData($<HTMLFormElement>("insert-form")),
      ) as Record<string, string>;
      dialog.close();
      apply(data);
    } else {
      dialog.close();
      focusEditor();
    }
  };
  dialog.oncancel = () => requestAnimationFrame(focusEditor);
  dialog.showModal();
  requestAnimationFrame(() =>
    dialog.querySelector<HTMLInputElement>("input,textarea")?.focus(),
  );
}
function execute(command: string, data: Record<string, any> = {}) {
  if (command === "selectAll") {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
      active.select();
    else runCommand(command);
    return;
  }
  if (
    (command === "undo" || command === "redo") &&
    (document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement)
  ) {
    document.execCommand(command);
    return;
  }
  if (command === "source")
    switchMode(getMode() === "source" ? "live" : "source");
  else if (command === "live" || command === "preview") switchMode(command);
  else if (command === "sidebar") toggleSidebar();
  else if (command === "outline") {
    app.classList.remove("sidebar-hidden");
    chooseTab("outline");
  } else if (command === "files") {
    app.classList.remove("sidebar-hidden");
    chooseTab("files");
  } else if (command === "find" || command === "replace")
    showFind(command === "replace");
  else if (command === "focus" || command === "typewriter") {
    app.classList.toggle(
      `${command === "focus" ? "focus" : "typewriter"}-mode`,
    );
  } else if (command === "theme") {
    document.documentElement.dataset.theme = data.theme || "newsprint";
    store.set("theme", data.theme);
    rich.refreshVisuals();
    schedulePreview();
  } else if (command === "link" && !("href" in data)) {
    const selected = getSelectedText();
    insertDialog(
      "插入链接",
      [
        { key: "text", label: "链接文本", value: selected },
        { key: "href", label: "链接地址", value: "https://" },
      ],
      (values) => runCommand("link", values),
    );
  } else if (command === "image" && !data.src)
    insertDialog(
      "插入图片",
      [
        { key: "src", label: "图片路径或URL" },
        { key: "alt", label: "替代文本" },
      ],
      (values) => runCommand("image", values),
    );
  else if (command === "table" && !data.rows)
    insertDialog(
      "插入表格",
      [
        { key: "rows", label: "行数（含表头）", value: "3", type: "number" },
        { key: "cols", label: "列数", value: "3", type: "number" },
      ],
      (values) =>
        runCommand("table", { rows: +values.rows, cols: +values.cols }),
    );
  else if (command === "math" && !data.latex)
    insertDialog(
      "插入数学公式",
      [{ key: "latex", label: "LaTeX", value: "E=mc^2", multiline: true }],
      (values) => runCommand("math", values),
    );
  else runCommand(command, data);
}
$("table-tools").onmousedown = (e) => e.preventDefault();
$("table-tools").onclick = (e) => {
  const command = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-command]",
  )?.dataset.command;
  if (command) execute(command);
};
$("word-count").onclick = () =>
  toast(
    `${getEditorContent().length}字符 · ${getEditorContent().split("\n").length}行 · ${$("word-count").textContent}`,
  );
// 右键菜单使用同一组编辑事务，保持选区与撤销一致。
$("rich-host").oncontextmenu = (e) => {
  e.preventDefault();
  const menu = $("context-menu");
  menu.replaceChildren();
  const commands = inTable()
    ? [
        ["添加行", "table.rowAfter"],
        ["添加列", "table.columnAfter"],
        ["删除行", "table.deleteRow"],
        ["删除列", "table.deleteColumn"],
        ["删除表格", "table.delete"],
      ]
    : [
        ["粗体", "bold"],
        ["斜体", "italic"],
        ["行内代码", "code"],
        ["链接…", "link"],
        ["图片…", "image"],
        ["表格…", "table"],
        ["任务列表", "task"],
      ];
  commands.forEach(([label, command]) => {
    const button = document.createElement("button");
    button.role = "menuitem";
    button.textContent = label;
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => {
      menu.hidden = true;
      execute(command);
    };
    menu.append(button);
  });
  menu.style.left = `${Math.min(e.clientX, innerWidth - 190)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - 300)}px`;
  menu.hidden = false;
};
document.addEventListener("mousedown", (e) => {
  if (!$("context-menu").contains(e.target as Node))
    $("context-menu").hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (!event.isComposing && (event.metaKey || event.ctrlKey) &&
      !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    event.stopPropagation();
    execute("selectAll");
  }
}, true);
document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key === "Escape") {
    $("context-menu").hidden = true;
    if (!$("find-bar").hidden) $("find-close").click();
    return;
  }
  if (!e.metaKey && !e.ctrlKey) return;
  const key = e.key.toLowerCase();
  if (key === "f") {
    e.preventDefault();
    showFind(e.shiftKey);
  }
  if (key === "/") {
    e.preventDefault();
    execute("source");
  }
  if (key === "l" && e.shiftKey) {
    e.preventDefault();
    toggleSidebar();
  }
  if (key === "k") {
    e.preventDefault();
    execute("link");
  }
});
bridge.registerHandler("editor.setBusy", ({ busy }) => {
  app.classList.toggle("busy", !!busy);
  setEditorBusy(!!busy);
  return {};
});
bridge.registerHandler("app.echo", (data) => data);
bridge.registerHandler("app.setTheme", ({ theme }: { theme: string }) => {
  document.documentElement.dataset.theme =
    theme === "light" ? "newsprint" : theme === "dark" ? "night" : theme;
  rich.refreshVisuals();
  schedulePreview();
});
bridge.registerHandler("app.setFont", ({ font }: { font: string }) => {
  if (!["ptserif", "theme", "system", "pingfang", "songti", "kaiti", "mono"].includes(font))
    throw new Error("未知字体选项");
  document.documentElement.dataset.font = font;
  store.set("font", font);
  requestAnimationFrame(updateActiveHeading);
  return {};
});
bridge.registerHandler("editor.command", ({ command, ...data }) => {
  execute(command, data);
  return {};
});
bridge.registerHandler("file.reloadIfClean", ({ documentID, content, expectedContent }: {
  documentID: string; content: string; expectedContent: string;
}) => {
  if (documentID !== docID) return { reloaded: false, reason: "documentChanged" };
  if (isDirty() || isEditorComposing()) return { reloaded: false, reason: "dirty" };
  if (getEditorContent() !== expectedContent) return { reloaded: false, reason: "baseline" };
  loading = true;
  try {
    setEditorContent(content, true);
  } finally {
    loading = false;
  }
  $("external-change-bar").hidden = true;
  updateOutline();
  updateStatistics();
  if (getMode() === "preview") schedulePreview(true);
  bridge.emit("file.contentChanged", { dirty: false, revision: getRevision(), documentID: docID });
  return { reloaded: true, revision: getRevision() };
});
bridge.onEvent("file.externalChange", ({ documentID, changed }) => {
  if (documentID === docID) $("external-change-bar").hidden = !changed;
});
for (const [id, action] of [["reload-from-disk", "reload"], ["overwrite-disk", "overwrite"], ["save-conflict-copy", "saveAs"]])
  $(id).onclick = () => {
    void bridge.callHandler("file.reloadFromDisk", { documentID: docID, action })
      .catch(() => toast("无法处理文件更新，请重试"));
  };
bridge.registerHandler(
  "file.read",
  ({
    path,
    content,
    generation,
    documentID,
  }: {
    path?: string;
    content?: string;
    generation?: number;
    documentID?: string;
  }) => {
    // 重发同一次载入只回执，不覆盖用户在首份回执之后的输入。
    const readID = documentID ? `${documentID}:${generation}` : generation;
    if (readID === undefined || readID !== lastReadID) {
      loading = true;
      docID = documentID || path || "";
      setDocumentPath(path || "");
      setEditorContent(content || "");
      if (getDocumentLanguage() !== null) setMode("preview");
      $("external-change-bar").hidden = true;
      loading = false;
      lastReadID = readID;
      updateOutline();
      updateStatistics();
      if (getMode() === "preview") schedulePreview();
      if (sidebarTab === "files") void loadFiles();
    }
    bridge.emit("file.readAck", {
      path: path || "",
      generation,
      documentID: docID,
    });
    return {};
  },
);
bridge.registerHandler("file.save", async () => {
  await waitForImages();
  return {
    content: getEditorContent(),
    revision: getRevision(),
    documentID: docID,
    dirty: isDirty(),
  };
});
bridge.registerHandler("file.status", () => ({
  dirty: isDirty(),
  revision: getRevision(),
  documentID: docID,
}));
bridge.registerHandler("file.requestFocus", focusEditor);
bridge.onEvent("file.writeDone", ({ content, documentID }) => {
  if (documentID === docID) {
    markSaved(content);
    $("external-change-bar").hidden = true;
  }
});
bridge.onEvent("file.pathChanged", ({ path }) => {
  setDocumentPath(path);
  refreshDocumentFormat();
  updateOutline();
  rich.refreshResources();
  if (getMode() === "preview") schedulePreview();
});
bridge.onEvent("file.listChanged", () => {
  if (sidebarTab === "files") void loadFiles();
});
updateOutline();
updateStatistics();
bridge.emit("app.ready", { kernelVersion: KERNEL_VERSION });
if (!window.webkit) {
  const theme = store.get("theme", "newsprint");
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.font = store.get("font", "ptserif");
}
