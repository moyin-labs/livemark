#!/usr/bin/env python3
"""验证长文档在虚拟化源码视图中全选复制，以及输入框与预览的选区。"""
import json

from browser_check import OUT, check, cli, evaluate, load, results

LONG_TEXT = '# begin-select-all\n\n' + ''.join(
    f'Line {i:04d}: source-selection-content-{i:04d}\n' for i in range(1200)
) + '\n# end-select-all\n'

if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    cli('navigate_page', '--type', 'reload', '--ignoreCache', 'true')
    cli('resize_page', '1120', '760')
    load(LONG_TEXT, 'select-all-source')
    evaluate('''
      window.__copySource=()=>{
        const data=new DataTransfer();
        document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));
        return data.getData('text/plain');
      };
      await window.__livemark.handlers.get('editor.command')({command:'source'});
      const scroller=document.querySelector('.cm-scroller');scroller.scrollTop=scroller.scrollHeight/2;
      await new Promise(r=>setTimeout(r,100));return {ok:true};
    ''')
    check('source_view_only_mounts_part_of_document', '''
      const dom=document.querySelector('.cm-content').textContent;
      return {ok:dom.length<5000&&!dom.includes('end-select-all'),mountedLength:dom.length};
    ''')
    for name, trigger in [
        ('menu_command_selects_full_source', "await window.__livemark.handlers.get('editor.command')({command:'selectAll'});"),
        ('control_a_selects_full_source', "document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'a',ctrlKey:true}));"),
        ('command_a_selects_full_source', "document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'a',metaKey:true}));"),
    ]:
        check(name, trigger + '''
          const copied=window.__copySource();
          return {ok:document.getElementById('app').dataset.mode==='source'&&copied===''' + json.dumps(LONG_TEXT) + ''',length:copied.length};
        ''')
    check('select_all_in_search_field_stays_in_field', '''
      const input=document.getElementById('sidebar-search');input.value='field-selection';input.focus();
      await window.__livemark.handlers.get('editor.command')({command:'selectAll'});
      const saved=await window.__livemark.handlers.get('file.save')();
      const ok=input.selectionStart===0&&input.selectionEnd===input.value.length&&!saved.dirty&&saved.revision===0;
      input.value='';return {ok};
    ''')
    evaluate('''
      await window.__livemark.handlers.get('file.read')({path:'/documents/select-all.txt',content:'''
      + json.dumps(LONG_TEXT) + ''',documentID:'select-all-preview',generation:1});
      await new Promise(r=>setTimeout(r,150));return {ok:true};
    ''')
    check('preview_select_all_includes_entire_text', '''
      document.querySelector('.cm-content').blur();document.activeElement?.blur();
      await window.__livemark.handlers.get('editor.command')({command:'selectAll'});
      const selected=getSelection().toString();
      return {ok:selected.trimEnd()===''' + json.dumps(LONG_TEXT.rstrip()) + ''',length:selected.length};
    ''')
    load('# first-heading\n\nfirst paragraph\n\nlast paragraph\n', 'select-all-live')
    check('live_select_all_uses_document_selection', '''
      await window.__livemark.handlers.get('editor.command')({command:'live'});
      document.querySelector('.ProseMirror').focus();
      await window.__livemark.handlers.get('editor.command')({command:'selectAll'});
      const data=new DataTransfer();
      document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));
      const text=data.getData('text/plain'),saved=await window.__livemark.handlers.get('file.save')();
      return {ok:text.includes('# first-heading')&&text.includes('first paragraph')&&text.includes('last paragraph')&&!saved.dirty};
    ''')
    (OUT / 'select_all_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
