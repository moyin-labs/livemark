import { Slice, Node as PMNode } from "prosemirror-model";
import { Selection, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { schema, serializeMarkdown } from "./schema";

export function serializeClipboardText(slice: Slice, selection: Selection): string {
  if (selection instanceof TextSelection && selection.$from.sameParent(selection.$to)) {
    const { $from, $to } = selection;
    if ($from.parent.type === schema.nodes.code_block) {
      // 代码块内部选中的文字按原文复制，不补围栏、语言名或末尾换行。
      return $from.parent.textBetween($from.parentOffset, $to.parentOffset);
    }
    if ($from.parent.isTextblock) {
      // 文字选区的切片也带有表格、列表、引用、标题等祖先节点。
      // 块内复制只序列化选中的行内内容，保留加粗/代码/链接等标记，
      // 不把未选中的外层结构和文档末尾换行带入纯文本剪贴板。
      const content = $from.parent.content.cut($from.parentOffset, $to.parentOffset);
      const paragraph = schema.nodes.paragraph.create(null, content);
      return serializeMarkdown(schema.nodes.doc.create(null, paragraph)).replace(/\n$/, "");
    }
  }
  if (selection instanceof CellSelection) {
    // 表格选区的切片通常直接包含行，不能当作完整文档交给Markdown渲染器。
    // 普通复制保留单元格内的标记，按视觉顺序拼接；HTML剪贴板仍保留表格结构。
    const rows: string[] = [];
    const appendRow = (row: PMNode) => {
      const cells: string[] = [];
      row.forEach((cell) => {
        cells.push(serializeMarkdown(schema.nodes.doc.create(null, cell.content)).trimEnd());
      });
      rows.push(cells.join(""));
    };
    slice.content.forEach((node) => {
      if (node.type.spec.tableRole === "table") node.forEach(appendRow);
      else appendRow(node);
    });
    return rows.join("\n");
  }
  return serializeMarkdown(schema.nodes.doc.create(null, slice.content));
}
