/** 以原阅读宽度为基准，只为宽内容扩容；函数自包含，HTML导出也使用同一逻辑。 */
export function setupDocumentWidth(root: HTMLElement): void {
  const selector = "table, pre, .katex-display";
  let frame = 0;
  let timer = 0;

  function update(): void {
    frame = 0;
    if (!root.getClientRects().length || !root.clientWidth) return;
    const style = getComputedStyle(root);
    const baseline = parseFloat(style.getPropertyValue("--paper-width")) || 860;
    const maximum = parseFloat(style.getPropertyValue("--paper-max-width")) || 1200;
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    let needed = baseline;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      (block) => block.getClientRects().length > 0,
    );

    if (blocks.length) {
      // 在编辑器外测量自然宽度，避免修改ProseMirror的DOM、光标和撤销历史。
      const probe = document.createElement("div");
      probe.className = "document";
      probe.setAttribute("aria-hidden", "true");
      probe.inert = true;
      probe.style.cssText =
        "position:fixed;left:-100000px;top:0;width:max-content;max-width:none;visibility:hidden;pointer-events:none;";
      probe.style.font = style.font;
      probe.style.lineHeight = style.lineHeight;
      const clones = blocks.map((block) => {
        const clone = block.cloneNode(true) as HTMLElement;
        clone.removeAttribute("id");
        clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
        clone.style.width = "max-content";
        clone.style.maxWidth = "none";
        clone.querySelectorAll<HTMLElement>("th, td").forEach((cell) => {
          cell.style.whiteSpace = "nowrap";
        });
        probe.appendChild(clone);
        return clone;
      });
      document.body.appendChild(probe);
      const left = root.getBoundingClientRect().left + parseFloat(style.paddingLeft);
      clones.forEach((clone, index) => {
        const indent = Math.max(0, blocks[index].getBoundingClientRect().left - left);
        needed = Math.max(
          needed,
          Math.ceil(Math.max(clone.scrollWidth, clone.getBoundingClientRect().width) + indent + padding),
        );
      });
      probe.remove();
    }

    const width = `${Math.min(maximum, needed)}px`;
    if (root.style.getPropertyValue("--content-width") !== width)
      root.style.setProperty("--content-width", width);
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(update);
  }

  const contentObserver = new MutationObserver((records) => {
    // 忽略控制器写回的宽度，内容编辑稍作合并，避免每次按键都触发布局测量。
    if (records.every((record) => record.target === root && record.type === "attributes")) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(schedule, 80);
  });
  contentObserver.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["style", "class", "colspan", "rowspan", "src"],
  });
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(root.parentElement!);
  const themeObserver = new MutationObserver(schedule);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-font"],
  });
  root.addEventListener("load", schedule, true);
  window.addEventListener("resize", schedule);
  document.fonts.ready.then(schedule);
  document.fonts.addEventListener("loadingdone", schedule);
  schedule();
}
