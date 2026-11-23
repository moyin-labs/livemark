#!/usr/bin/env python3
"""验证真实回车查找、循环、输入焦点、滚动、输入法及替换不回归。"""
import json

from browser_check import OUT, check, cli, evaluate, load, results

QUERY = 'statusline-command.sh'
GAP = '\n\n'.join(f'间隔段落{i}：用于验证搜索跳转和页面滚动。' for i in range(35))
DOCUMENT = f'''# 搜索跳转测试

{GAP}

第一处：`{QUERY}`

{GAP}

```bash
echo "{'long-path/' * 45}{QUERY}"
```

{GAP}

| 项目 | 文件 |
| --- | --- |
| 第三处 | {QUERY} |

{GAP}
'''


def query(text):
    evaluate('''const input=document.getElementById('find-input');input.focus();
      input.value=''' + json.dumps(text) + ''';input.dispatchEvent(new Event('input'));return {};''')


def position(name, expected):
    check(name, f'''
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const input=document.getElementById('find-input'),pane=document.getElementById('writing-pane');
      const match=document.querySelector('.search-match.current'),count=document.getElementById('find-count').textContent;
      const rect=match?.getBoundingClientRect(),bounds=pane.getBoundingClientRect();
      const code=match?.closest('pre'),codeBounds=code?.getBoundingClientRect();
      const visible=!!rect&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1&&
        rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&
        (!codeBounds||(rect.left>=codeBounds.left-1&&rect.right<=codeBounds.right+1));
      return {{ok:count==={json.dumps(expected)}&&document.activeElement===input&&visible,
        count,focus:document.activeElement?.id,visible,scrollTop:pane.scrollTop,codeScroll:code?.scrollLeft}};
    ''')


if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    cli('navigate_page', '--type', 'reload', '--ignoreCache', 'true')
    cli('resize_page', '1200', '800')
    load(DOCUMENT, 'search-navigation')
    evaluate("await window.__livemark.handlers.get('editor.command')({command:'find'});return {};")
    query(QUERY)
    for name, key, expected in [
        ('enter_first', 'Enter', '1/3'),
        ('enter_code_and_horizontal_scroll', 'Enter', '2/3'),
        ('enter_table', 'Enter', '3/3'),
        ('enter_wrap', 'Enter', '1/3'),
        ('shift_enter_wrap', 'Shift+Enter', '3/3'),
        ('shift_enter_previous', 'Shift+Enter', '2/3'),
    ]:
        cli('press_key', key)
        position(name, expected)
    check('composition_enter_is_ignored', '''
      const input=document.getElementById('find-input'),before=document.getElementById('find-count').textContent;
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}));
      return {ok:document.getElementById('find-count').textContent===before&&document.activeElement===input};
    ''')
    evaluate("document.getElementById('find-next').click();return {};")
    position('next_button_keeps_find_focus', '3/3')
    evaluate("document.getElementById('find-prev').click();return {};")
    position('previous_button_keeps_find_focus', '2/3')
    query('not-present-in-document')
    cli('press_key', 'Enter')
    check('no_results', "return {ok:document.getElementById('find-count').textContent==='0/0'&&!document.querySelector('.search-match')};")
    query('')
    cli('press_key', 'Shift+Enter')
    check('empty_query', "return {ok:document.getElementById('find-count').textContent==='0/0'&&!document.querySelector('.search-match')};")
    check('navigation_never_edits_document', 'const saved=await window.__livemark.handlers.get("file.save")();return {ok:!saved.dirty&&saved.content===' + json.dumps(DOCUMENT) + '};')
    load('needle NEEDLE needle\n', 'search-replace')
    query('needle')
    cli('press_key', 'Enter')
    position('new_document_query', '1/3')
    evaluate("document.getElementById('find-case').click();return {};")
    cli('press_key', 'Enter')
    position('case_sensitive_next', '2/2')
    evaluate("document.getElementById('find-replace-toggle').click();return {};")
    cli('press_key', 'Enter')
    position('enter_with_replace_row_visible', '1/2')
    evaluate("document.getElementById('replace-input').value='updated';document.getElementById('replace-one').click();return {};")
    position('replace_then_next', '1/1')
    check('replace_changes_only_current', '''
      const saved=await window.__livemark.handlers.get('file.save')();
      return {ok:saved.content==='updated NEEDLE needle\\n'};
    ''')
    cli('press_key', 'Escape')
    check('escape_clears_highlights', "return {ok:document.getElementById('find-bar').hidden&&!document.querySelector('.search-match')};")
    (OUT / 'search_navigation_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
