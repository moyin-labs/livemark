#!/usr/bin/env python3
"""验证表格与代码块选区复制、HTML结构、剪切撤销及普通文字复制。"""
import json

from browser_check import OUT, check, cli, evaluate, load, results

TABLE = '''# 复制测试

| 场景 | 国内 | 海外 |
| --- | --- | --- |
| 原生防护巡检 | `gf_native_recommd_by_llm_inspect` | `gf_native_recommd_by_llm_inspect_overseas` |
| 代理高防巡检 | `gf_proxy_recommd_by_llm_inspect` | `gf_proxy_recommd_by_llm_inspect_overseas` |
'''
FIRST = '原生防护巡检`gf_native_recommd_by_llm_inspect``gf_native_recommd_by_llm_inspect_overseas`'
SECOND = '代理高防巡检`gf_proxy_recommd_by_llm_inspect``gf_proxy_recommd_by_llm_inspect_overseas`'

if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    cli('navigate_page', '--type', 'reload', '--ignoreCache', 'true')
    cli('resize_page', '1920', '1080')
    load(TABLE, 'clipboard-table')
    evaluate('''
      window.__selectCells=(from,to)=>{
        const cells=document.querySelectorAll('.ProseMirror th,.ProseMirror td');
        const a=cells[from].getBoundingClientRect(),b=cells[to].getBoundingClientRect();
        cells[from].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:a.left+10,clientY:a.top+10}));
        cells[to].dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:b.left+10,clientY:b.top+10}));
        document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      };
      window.__copySelection=(type='copy')=>{
        const data=new DataTransfer(),event=new ClipboardEvent(type,{bubbles:true,cancelable:true,clipboardData:data});
        document.querySelector('.ProseMirror').dispatchEvent(event);
        const html=data.getData('text/html'),doc=new DOMParser().parseFromString(html,'text/html');
        return {text:data.getData('text/plain'),html,prevented:event.defaultPrevented,
          cells:doc.querySelectorAll('td,th').length,rows:doc.querySelectorAll('tr').length};
      };
      return {ok:true};
    ''')
    check('dragged_row_copies_all_cells_with_code_marks', '''
      window.__selectCells(3,5); const copied=window.__copySelection();
      return {...copied,ok:copied.prevented&&copied.text===''' + json.dumps(FIRST) + '''&&copied.cells===3};
    ''')
    check('reverse_drag_preserves_document_order', '''
      window.__selectCells(5,3); const copied=window.__copySelection();
      return {...copied,ok:copied.text===''' + json.dumps(FIRST) + '''&&copied.cells===3};
    ''')
    check('multiple_rows_preserve_line_breaks_and_html', '''
      window.__selectCells(3,8); const copied=window.__copySelection();
      return {...copied,ok:copied.text===''' + json.dumps(FIRST + '\n' + SECOND) + '''&&copied.cells===6&&copied.rows===2};
    ''')
    check('whole_table_copies_headers_and_all_rows', '''
      window.__selectCells(0,8); const copied=window.__copySelection();
      return {...copied,ok:copied.text===''' + json.dumps('场景国内海外\n' + FIRST + '\n' + SECOND) + '''&&copied.cells===9&&copied.rows===3};
    ''')
    check('single_cell_selection_preserves_code_marks', '''
      window.__selectCells(4,5);
      const cell=document.querySelectorAll('.ProseMirror th,.ProseMirror td')[4],a=cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,shiftKey:true,clientX:a.left+10,clientY:a.top+10}));
      document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      const copied=window.__copySelection();
      return {...copied,ok:copied.text==='`gf_native_recommd_by_llm_inspect`'&&copied.cells===1};
    ''')
    check('copy_does_not_modify_document', '''
      const saved=await window.__livemark.handlers.get('file.save')();
      return {ok:!saved.dirty&&saved.content===''' + json.dumps(TABLE) + '''};
    ''')
    check('cut_copies_all_cells_and_undo_restores', '''
      window.__selectCells(3,5); const copied=window.__copySelection('cut');
      const cut=await window.__livemark.handlers.get('file.save')();
      await window.__livemark.handlers.get('editor.command')({command:'undo'});
      const undone=await window.__livemark.handlers.get('file.save')();
      return {ok:copied.text===''' + json.dumps(FIRST) + '''&&cut.dirty&&
        !cut.content.includes('gf_native_recommd_by_llm_inspect')&&undone.content===''' + json.dumps(TABLE) + '''&&!undone.dirty};
    ''')
    load('普通文字与`代码`。\n', 'clipboard-text')
    check('ordinary_text_copy_keeps_markdown', '''
      const root=document.querySelector('.ProseMirror'),p=root.querySelector('p');
      root.focus();const range=document.createRange();range.selectNodeContents(p);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise(r=>setTimeout(r,80));
      const copied=window.__copySelection();
      return {...copied,ok:copied.prevented&&copied.text.trim()==='普通文字与`代码`。'};
    ''')
    # 文字选区与整格选区是不同路径；覆盖用户报告的单元格数字及其他块内文字。
    evaluate('''
      window.__selectInlineText=async(selector,from,to)=>{
        const root=document.querySelector('.ProseMirror'),element=root.querySelector(selector);
        root.focus();
        const nodes=[],walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()) {
          if(!walker.currentNode.parentElement.closest('[contenteditable="false"]')) nodes.push(walker.currentNode);
        }
        const point=offset=>{
          for(const node of nodes){if(offset<=node.length)return [node,offset];offset-=node.length;}
          throw new Error('文字选区偏移超出范围');
        };
        getSelection().setBaseAndExtent(...point(from),...point(to));
        document.dispatchEvent(new Event('selectionchange'));
        await new Promise(r=>setTimeout(r,80));
      };
      return {ok:true};
    ''')
    table_text = '''## Top20 典型客户

| # | aliuid | 客户 | GC | 日志量/小时 | 主region | 业务线 |
|---|--------|------|----|------------|----------|--------|
| 1 | 123456 | xxxx | GC7 | 2.85 亿 | ap-southeast-1 | 海外-欧美日韩 |
| 2 | 666777 | xxxx | GC7 | 2.62 亿 | ap-southeast-1 | 海外-东南亚 |
'''
    for name, document, selector, start, end, expected in [
        ('cell_text_without_table_wrapper', table_text, 'td:nth-child(2) p', 0, 6, '123456'),
        ('cell_partial_text', table_text, 'td:nth-child(2) p', 1, 4, '234'),
        ('cell_reverse_text', table_text, 'td:nth-child(2) p', 6, 0, '123456'),
        ('header_text_without_table_wrapper', table_text, 'th:nth-child(2) p', 0, 6, 'aliuid'),
        ('heading_text_without_heading_wrapper', '## Top20 典型客户\n', 'h2', 1, 4, 'op2'),
        ('bullet_text_without_list_wrapper', '- 前缀123456后缀\n', 'li p', 2, 8, '123456'),
        ('ordered_text_without_list_wrapper', '1. 前缀123456后缀\n', 'li p', 2, 8, '123456'),
        ('quote_text_without_quote_wrapper', '> 前缀123456后缀\n', 'blockquote p', 2, 8, '123456'),
        ('nested_text_without_ancestor_wrappers', '> - 前缀123456后缀\n', 'li p', 2, 8, '123456'),
        ('task_text_without_task_wrapper', '- [ ] 前缀123456后缀\n', 'li p', 2, 8, '123456'),
        ('cell_inline_marks_preserved', '| 表头 |\n| --- |\n| **加粗**与`代码` |\n', 'td p', 0, 5, '**加粗**与`代码`'),
    ]:
        load(document, name)
        check(name, f'''
          await window.__selectInlineText({json.dumps(selector)},{start},{end});
          const copied=window.__copySelection();
          const saved=await window.__livemark.handlers.get('file.save')();
          return {{...copied,ok:copied.prevented&&copied.text==={json.dumps(expected)}&&!saved.dirty}};
        ''')
    load(table_text, 'cell-text-cut')
    check('cell_text_cut_and_undo', f'''
      await window.__selectInlineText('td:nth-child(2) p',0,6);
      const copied=window.__copySelection('cut');
      const cut=await window.__livemark.handlers.get('file.save')();
      await window.__livemark.handlers.get('editor.command')({{command:'undo'}});
      const undone=await window.__livemark.handlers.get('file.save')();
      return {{ok:copied.text==='123456'&&!cut.content.includes('123456')&&
        undone.content==={json.dumps(table_text)}&&!undone.dirty}};
    ''')
    code = '  echo "5270080652696429"\n\n  printf "done"  '
    code_document = '说明段落\n\n```bash\n' + code + '\n```\n'
    load(code_document, 'clipboard-code')
    evaluate('''
      window.__selectCodeText=async(from,to)=>{
        const root=document.querySelector('.ProseMirror'),code=root.querySelector('.code-block code');
        const nodes=[],walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()) nodes.push(walker.currentNode);
        const point=offset=>{
          for(const node of nodes){if(offset<=node.length)return [node,offset];offset-=node.length;}
          throw new Error('代码选区偏移超出范围');
        };
        root.focus();getSelection().setBaseAndExtent(...point(from),...point(to));
        document.dispatchEvent(new Event('selectionchange'));
        await new Promise(r=>setTimeout(r,80));
      };
      return {ok:true};
    ''')
    offset = code.index('5270080652696429')
    for name, start, end, expected in [
        ('code_number_copies_without_fences', offset, offset + 16, '5270080652696429'),
        ('reverse_code_selection_copies_without_fences', offset + 16, offset, '5270080652696429'),
        ('multiline_code_preserves_whitespace', 0, len(code), code),
    ]:
        check(name, f'''
          await window.__selectCodeText({start},{end});const copied=window.__copySelection();
          return {{...copied,ok:copied.prevented&&copied.text==={json.dumps(expected)}}};
        ''')
    check('code_cut_and_undo_preserve_document', f'''
      await window.__selectCodeText({offset},{offset + 16});
      const copied=window.__copySelection('cut');
      const cut=await window.__livemark.handlers.get('file.save')();
      await window.__livemark.handlers.get('editor.command')({{command:'undo'}});
      const undone=await window.__livemark.handlers.get('file.save')();
      return {{ok:copied.text==='5270080652696429'&&!cut.content.includes('5270080652696429')&&
        undone.content==={json.dumps(code_document)}&&!undone.dirty}};
    ''')
    check('selection_across_prose_and_code_keeps_markdown_structure', '''
      const root=document.querySelector('.ProseMirror'),p=root.querySelector('p'),code=root.querySelector('.code-block code');
      root.focus();const range=document.createRange();range.setStart(p.firstChild,0);range.setEndAfter(code.lastChild);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));await new Promise(r=>setTimeout(r,80));
      const copied=window.__copySelection();
      return {...copied,ok:copied.text.includes('说明段落')&&copied.text.includes('```bash')&&copied.text.includes('5270080652696429')};
    ''')
    (OUT / 'clipboard_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
