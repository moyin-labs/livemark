#!/usr/bin/env python3
"""验证文本格式预览、原文保存、模式切换及外部刷新。"""
import json

from browser_check import OUT, check, cli, evaluate, results


def read_document(name, content):
    return evaluate('await window.__livemark.handlers.get("file.read")(' + json.dumps({
        'path': '/documents/' + name,
        'content': content,
        'documentID': name,
        'generation': 1,
    }) + '); await new Promise(r=>setTimeout(r,150)); return {ok:true};')


if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    cli('navigate_page', '--type', 'reload', '--ignoreCache', 'true')
    samples = {
        'sample.json': '{\n  "enabled": true,\n  "html": "<script>alert(1)</script>",\n  "items": [1, 2]\n}\n',
        'sample.yaml': '---\n# 配置注释\nenabled: true\nitems:\n  - name: "测试"\n    port: 8080\n',
        'sample.yml': 'enabled: false\nmessage: |\n  **保留标记**\n  第二行\n',
        'sample.txt': '# 原始标题\n\n**原始标记**\n<script>alert(1)</script>\n  保留缩进\n',
        'invalid.json': '{\n  "unfinished": [1,\n',
    }
    for name, content in samples.items():
        read_document(name, content)
        check(name + '_preview_and_roundtrip', '''
          const preview=document.getElementById('preview'),saved=await window.__livemark.handlers.get('file.save')();
          const raw=''' + json.dumps(content) + ''';
          return {ok:document.getElementById('app').dataset.mode==='preview'&&
            preview.querySelector('pre code')?.textContent===raw&&saved.content===raw&&!saved.dirty&&
            !preview.querySelector('script,h1,strong,img')&&document.querySelectorAll('.outline-item').length===0,
            language:preview.querySelector('code')?.className};
        ''')
        if name in ['sample.json', 'sample.yaml']:
            check(name + '_syntax_highlight', '''
              return {ok:!!document.querySelector('#preview code span[class^="hljs-"]')};
            ''')
    read_document('edit.json', '{"value": 1}\n')
    check('source_edit_preserves_raw_file_format', '''
      await window.__livemark.handlers.get('editor.command')({command:'source'});
      const content=document.querySelector('.cm-content');content.focus();
      const selection=getSelection(),range=document.createRange();range.selectNodeContents(content);
      selection.removeAllRanges();selection.addRange(range);
      document.execCommand('insertText',false,'{"value": 2}');
      await new Promise(r=>setTimeout(r,100));
      const saved=await window.__livemark.handlers.get('file.save')();
      await window.__livemark.handlers.get('editor.command')({command:'source'});
      await new Promise(r=>setTimeout(r,150));
      return {ok:saved.content==='{"value": 2}'&&saved.dirty&&
        document.getElementById('app').dataset.mode==='preview'&&document.querySelector('#preview code').textContent===saved.content,
        saved:saved.content};
    ''')
    read_document('reload.yaml', 'value: 1\n')
    check('external_reload_refreshes_text_preview', '''
      const response=await window.__livemark.handlers.get('file.reloadIfClean')({documentID:'reload.yaml',expectedContent:'value: 1\\n',content:'value: 2\\n'});
      await new Promise(r=>setTimeout(r,150));
      return {ok:response.reloaded&&document.querySelector('#preview code').textContent==='value: 2\\n'};
    ''')
    read_document('return.md', '# Markdown标题\n\n**加粗正文**\n')
    check('markdown_still_renders_after_text_document', '''
      await window.__livemark.handlers.get('editor.command')({command:'live'});
      return {ok:document.getElementById('app').dataset.mode==='live'&&
        document.querySelector('.ProseMirror h1')?.textContent==='Markdown标题'&&!!document.querySelector('.ProseMirror strong')};
    ''')
    check('markdown_source_edits_update_preview_outline', '''
      await window.__livemark.handlers.get('editor.command')({command:'source'});
      const content=document.querySelector('.cm-content');content.focus();
      const range=document.createRange();range.selectNodeContents(content);
      getSelection().removeAllRanges();getSelection().addRange(range);
      document.execCommand('insertText',false,'# 更新后的标题');
      await new Promise(r=>setTimeout(r,100));
      await window.__livemark.handlers.get('editor.command')({command:'preview'});
      await new Promise(r=>setTimeout(r,150));
      return {ok:document.querySelector('#preview h1')?.textContent==='更新后的标题'&&
        document.querySelector('.outline-item')?.textContent==='更新后的标题'};
    ''')
    (OUT / 'text_preview_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
