import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMarkdown, serializeMarkdown } from "../kernel-src/src/schema";
const cases: Record<string, string> = {
  fixture: readFileSync("app/tests/fixtures/ui_fixture.md", "utf8"),
  nestedLists:
    "# 标题\n\n- [ ] 任务\n  - 嵌套项目\n- [x] 完成\n\n1. 第一项\n2. 第二项\n",
  tables:
    "| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| **粗体** | `code` | [链接](https://example.com) |\n",
  math: "$E=mc^2$\n\n$$\nx^2+y^2=z^2\n$$\n",
  extended: "==高亮**粗体**==和<u>下划线</u>\n\n正文[^1]\n\n[^1]: 脚注说明\n",
  raw: '---\ntitle: 测试\n---\n\n<div>原始HTML</div>\n\n<span class="test">inline</span>\n',
  code: '```mermaid\ngraph LR\n A-->B\n```\n\n````js\nconst fence = "```";\n````\n',
};
for (const [name, markdown] of Object.entries(cases)) {
  const doc = parseMarkdown(markdown);
  const output = serializeMarkdown(doc);
  const reparsed = parseMarkdown(output);
  assert.deepEqual(
    reparsed.toJSON(),
    doc.toJSON(),
    `${name} roundtrip failed:\n${output}`,
  );
  console.log(`${name}: PASS`);
}
const tasks = parseMarkdown(cases.nestedLists).toJSON();
assert.equal(tasks.content[1].content[0].attrs.checked, false);
assert.equal(tasks.content[1].content[1].attrs.checked, true);
const html = serializeMarkdown(parseMarkdown(cases.raw));
assert.ok(html.includes("<div>原始HTML</div>"));
assert.ok(html.includes('<span class="test">'));
const extended = parseMarkdown(cases.extended).toJSON();
assert.ok(JSON.stringify(extended).includes("highlight"));
assert.ok(JSON.stringify(extended).includes("underline"));
console.log("task attributes / raw preservation / extended marks: PASS");
