#!/usr/bin/env python3
"""验证阅读宽度、宽内容扩容与收回、宽度上限，以及预览和HTML导出。"""
import json

from browser_check import OUT, check, cli, load, results


def table(headers):
    return '\n'.join([
        '| ' + ' | '.join(headers) + ' |',
        '| ' + ' | '.join('---' for _ in headers) + ' |',
        '| ' + ' | '.join('3.3' for _ in headers) + ' |',
    ]) + '\n'


def settle_check(name, body):
    check(name, 'await new Promise(r=>setTimeout(r,250));' + body)


if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    cli('resize_page', '1920', '1080')
    prose = '# 阅读宽度\n\n' + '普通长段落应当保持原来的阅读宽度。' * 100 + '\n'
    load(prose, 'layout-prose')
    settle_check('prose_keeps_reading_width', '''
      const host=document.querySelector('#rich-host');
      return {ok:host.offsetWidth===860,width:host.offsetWidth};
    ''')

    short_table = table(['产品线', '2026-07', '2026-08'])
    load(short_table, 'layout-short-table')
    settle_check('short_table_keeps_reading_width', '''
      const host=document.querySelector('#rich-host');
      return {ok:host.offsetWidth===860,width:host.offsetWidth};
    ''')

    load(table(['2026-'+str(i).zfill(2) for i in range(1, 10)]), 'layout-medium-table')
    settle_check('medium_table_only_expands_as_needed', '''
      const host=document.querySelector('#rich-host'),w=host.querySelector('.tableWrapper');
      return {ok:host.offsetWidth>860&&host.offsetWidth<1200&&w.scrollWidth<=w.clientWidth+1,
        width:host.offsetWidth};
    ''')

    wide_table = table(['产品线', '2026-07', '2026-08', '2026-08（高防EIP1-13日）',
                        '2026-08（高防EIP14-31日）', '2026-09', '2026-10', '2026-11（截止03日）'])
    load(wide_table, 'layout-wide-table')
    settle_check('wide_table_expands_with_cap', '''
      const host=document.querySelector('#rich-host'),w=host.querySelector('.tableWrapper');
      return {ok:host.offsetWidth>860&&host.offsetWidth<=1200&&w.scrollWidth<=w.clientWidth+1,
        width:host.offsetWidth,scroll:w.scrollWidth,available:w.clientWidth};
    ''')
    cli('take_screenshot', '--filePath', str(OUT / 'layout_adaptive.png'))
    settle_check('layout_does_not_change_document', '''
      const saved=await window.__livemark.handlers.get('file.save')();
      return {ok:!saved.dirty&&saved.revision===0,revision:saved.revision};
    ''')

    load(table(['月份'+str(i) for i in range(18)]), 'layout-cap')
    settle_check('oversized_table_scrolls_at_cap', '''
      const host=document.querySelector('#rich-host'),w=host.querySelector('.tableWrapper'),pane=host.parentElement;
      return {ok:host.offsetWidth===1200&&w.scrollWidth>w.clientWidth&&pane.scrollWidth===pane.clientWidth,
        width:host.offsetWidth,scroll:w.scrollWidth};
    ''')

    load(wide_table, 'layout-preview')
    check('switch_preview', '''
      await window.__livemark.handlers.get('editor.command')({command:'preview'});
      return {ok:true};
    ''')
    settle_check('preview_expands', '''
      const host=document.querySelector('#preview'),w=host.querySelector('.tableWrapper');
      return {ok:host.offsetWidth>860&&host.offsetWidth<=1200&&w.scrollWidth<=w.clientWidth+1,
        width:host.offsetWidth};
    ''')
    cli('resize_page', '900', '760')
    settle_check('narrow_window_contains_scroll', '''
      const host=document.querySelector('#preview'),w=host.querySelector('.tableWrapper'),pane=host.parentElement;
      return {ok:host.offsetWidth<=pane.clientWidth&&pane.scrollWidth===pane.clientWidth&&w.scrollWidth>w.clientWidth,
        width:host.offsetWidth,available:pane.clientWidth};
    ''')
    cli('resize_page', '1920', '1080')
    check('switch_live', '''
      await window.__livemark.handlers.get('editor.command')({command:'live'});
      return {ok:true};
    ''')
    settle_check('wide_window_restores_fit', '''
      const host=document.querySelector('#rich-host'),w=host.querySelector('.tableWrapper');
      return {ok:host.offsetWidth>860&&host.offsetWidth<=1200&&w.scrollWidth<=w.clientWidth+1,width:host.offsetWidth};
    ''')
    check('export_runs_same_layout', '''
      const exported=await window.__livemark.handlers.get('export.requestHtml')({standalone:true});
      const frame=document.createElement('iframe');
      frame.style.cssText='position:fixed;left:-100000px;width:1800px;height:500px';
      document.body.appendChild(frame);
      await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc=exported.html});
      await new Promise(r=>setTimeout(r,300));
      const host=frame.contentDocument.querySelector('article.document'),w=host.querySelector('.tableWrapper');
      const result={ok:host.offsetWidth>860&&host.offsetWidth<=1200&&w.scrollWidth<=w.clientWidth+1,width:host.offsetWidth};
      frame.remove();return result;
    ''')
    check('delete_wide_table', '''
      const cell=document.querySelector('.ProseMirror td p');
      const selection=getSelection(),range=document.createRange();
      range.selectNodeContents(cell);range.collapse(true);
      selection.removeAllRanges();selection.addRange(range);
      document.querySelector('.ProseMirror').focus();
      await new Promise(r=>setTimeout(r,80));
      await window.__livemark.handlers.get('editor.command')({command:'table.delete'});
      return {ok:!document.querySelector('.ProseMirror table')};
    ''')
    settle_check('deletion_restores_reading_width', '''
      const host=document.querySelector('#rich-host');
      return {ok:host.offsetWidth===860,width:host.offsetWidth};
    ''')
    load('```text\n' + 'W' * 140 + '\n```\n', 'layout-code')
    settle_check('wide_code_uses_cap', '''
      const host=document.querySelector('#rich-host');
      return {ok:host.offsetWidth===1200&&host.parentElement.scrollWidth===host.parentElement.clientWidth,width:host.offsetWidth};
    ''')
    load(prose, 'layout-theme')
    check('change_theme', '''
      await window.__livemark.handlers.get('app.setTheme')({theme:'gothic'});
      return {ok:true};
    ''')
    settle_check('theme_keeps_original_width', '''
      const host=document.querySelector('#rich-host');
      return {ok:host.offsetWidth===800,width:host.offsetWidth};
    ''')
    (OUT / 'layout_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
