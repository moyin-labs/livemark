#!/usr/bin/env python3
"""验证即时编辑不会露出行内分隔符，且阅读与源码模式均保留格式。"""
import json

from browser_check import OUT, check, cli, load, results


if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    original = ('**关键数据（DDoS误伤率指标）**\n\n'
                '正文 **粗体**、*斜体*、~~删除线~~、==高亮==和`**代码原文**`。\n')
    load(original, 'inline-rendering')
    check('bold_renders_without_delimiters', '''
      const pm=document.querySelector('.ProseMirror'),p=pm.querySelector('p');
      return {ok:p.textContent==='关键数据（DDoS误伤率指标）'&&!!p.querySelector('strong')
        &&!pm.querySelector('.inline-marker'),text:p.textContent};
    ''')
    check('marks_and_code_keep_their_content', '''
      const p=document.querySelectorAll('.ProseMirror p')[1];
      return {ok:p.querySelector('strong')?.textContent==='粗体'
        &&p.querySelector('em')?.textContent==='斜体'
        &&p.querySelector('del')?.textContent==='删除线'
        &&p.querySelector('mark')?.textContent==='高亮'
        &&p.querySelector('code')?.textContent==='**代码原文**',text:p.textContent};
    ''')
    check('reading_typography', '''
      await window.__livemark.handlers.get('app.setTheme')({theme:'newsprint'});
      await window.__livemark.handlers.get('app.setFont')({font:'ptserif'});
      await document.fonts.load('16px "PT Serif"');
      const style=getComputedStyle(document.querySelector('#rich-host'));
      return {ok:style.fontWeight==='400'&&style.fontSize==='16px'
        &&style.webkitFontSmoothing==='antialiased'&&style.fontFamily.endsWith('serif')
        &&!style.fontFamily.includes('Songti SC'),font:style.fontFamily,
        weight:style.fontWeight,smoothing:style.webkitFontSmoothing};
    ''')
    check('reading_does_not_change_markdown', '''
      const saved=await window.__livemark.handlers.get('file.save')();
      return {ok:saved.content===%s&&!saved.dirty&&saved.revision===0};
    ''' % json.dumps(original))
    cli('press_key', 'ArrowRight')
    cli('type_text', '新增')
    check('editing_bold_keeps_format_without_markers', '''
      const p=document.querySelector('.ProseMirror p');
      const saved=await window.__livemark.handlers.get('file.save')();
      return {ok:p.querySelector('strong')?.textContent.includes('新增')
        &&!p.textContent.includes('**')&&!p.querySelector('.inline-marker')
        &&saved.content.includes('**')&&saved.dirty,text:p.textContent};
    ''')
    check('undo_restores_original_markdown', '''
      await window.__livemark.handlers.get('editor.command')({command:'undo'});
      const saved=await window.__livemark.handlers.get('file.save')();
      return {ok:saved.content===%s&&!saved.dirty};
    ''' % json.dumps(original))
    check('source_retains_markdown_delimiters', '''
      await window.__livemark.handlers.get('editor.command')({command:'source'});
      return {ok:document.querySelector('#app').dataset.mode==='source'
        &&document.querySelector('.cm-content').textContent.includes('**关键数据')};
    ''')
    check('preview_keeps_rendered_bold', '''
      await window.__livemark.handlers.get('editor.command')({command:'preview'});
      await new Promise(resolve=>setTimeout(resolve,200));
      const p=document.querySelector('#preview p');
      return {ok:p?.textContent==='关键数据（DDoS误伤率指标）'&&!!p.querySelector('strong')};
    ''')
    (OUT / 'rendering_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
