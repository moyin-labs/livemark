# 第三方组件声明

LiveMark界面与业务代码为本项目实现。构建按esbuild的实际依赖图生成[THIRD_PARTY_NOTICES.txt](Sources/LiveMark/Resources/WebKernel/THIRD_PARTY_NOTICES.txt)，其中包含进入WebKernel的直接与传递依赖版权声明及许可文本。

| 组件 | 用途 | 许可与上游 |
|---|---|---|
| ProseMirror及其官方模块 | 正文文档模型、编辑事务、历史、Markdown解析/序列化、表格 | [MIT](https://github.com/ProseMirror/prosemirror-view/blob/master/LICENSE) |
| CodeMirror 6、Lezer | 源码模式、语法高亮、搜索与编辑命令 | [MIT](https://github.com/codemirror/dev/blob/main/LICENSE) |
| markdown-it | 预览与HTML导出 | [MIT](https://github.com/markdown-it/markdown-it/blob/master/LICENSE) |
| markdown-it-task-lists | 预览任务列表 | [ISC](https://github.com/revin/markdown-it-task-lists/blob/master/LICENSE) |
| markdown-it-footnote | 预览脚注 | [MIT](https://github.com/markdown-it/markdown-it-footnote/blob/master/LICENSE) |
| highlight.js | 正文代码块及导出高亮 | [BSD-3-Clause](https://github.com/highlightjs/highlight.js/blob/main/LICENSE) |
| KaTeX及随包分发字体/CSS | 数学公式 | [MIT](https://github.com/KaTeX/KaTeX/blob/main/LICENSE) |
| PT Serif（常规、粗体、斜体、粗斜体） | 正文与侧栏字体，HTML导出内嵌 | [SIL OFL 1.1](https://github.com/google/fonts/blob/main/ofl/ptserif/OFL.txt)，[Google Fonts上游](https://github.com/google/fonts/tree/main/ofl/ptserif) |
| Mermaid | 图表渲染 | [MIT](https://github.com/mermaid-js/mermaid/blob/develop/LICENSE) |
| DOMPurify | 预览HTML清理 | [Apache-2.0或MPL-2.0](https://github.com/cure53/DOMPurify/blob/main/LICENSE) |
| esbuild | 构建期打包 | [MIT](https://github.com/evanw/esbuild/blob/main/LICENSE.md) |

KaTeX资源从安装的开源npm包复制。主题CSS为自有实现，没有从Typora应用包复制资源；界面图标使用系统SF Symbols或自有简单图形。Typora是appmakes.io的产品，本项目没有与其关联或使用其授权实现。
