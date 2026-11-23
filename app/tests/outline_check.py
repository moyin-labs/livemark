#!/usr/bin/env python3
"""验证大纲长标题完整换行、层级缩进、纵向滚动和点击跳转。"""
import json

from browser_check import OUT, check, cli, load, results

if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    cli('resize_page', '1512', '845')
    title = '47.118.168.131AOTR认证与TCP透传原因分析'
    nested = '配置时序：必须用本VIP、本机器的最后一次更新，并展示完整长标题'
    text = '# ' + title + '\n\n'
    text += '\n\n'.join('### ' + str(i) + '. ' + nested + '\n\n' + '正文段落。' * 30 for i in range(30))
    text += '\n\n###### ' + 'long_unbroken_identifier_' * 15 + '\n\n最后一节\n'
    load(text, 'outline-wrapping')
    check('outline_wraps_at_all_sidebar_widths', '''
      const app=document.getElementById('app'); app.classList.remove('sidebar-hidden');
      const sizes=[];
      for (const width of [180,240,291,400]) {
        app.style.setProperty('--sidebar-width',width+'px');
        const nav=document.getElementById('outline'),items=[...nav.querySelectorAll('.outline-item')];
        const fits=items.every(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1);
        sizes.push({width,fits,wraps:items[1].clientHeight>50,scrolls:nav.scrollHeight>nav.clientHeight});
      }
      return {ok:sizes.every(s=>s.fits&&s.wraps&&s.scrolls),sizes};
    ''')
    check('outline_preserves_titles_and_hierarchy', '''
      const items=[...document.querySelectorAll('.outline-item')],first=items[0],nested=items[1];
      return {ok:items.length===32&&first.textContent===''' + json.dumps(title) + '''&&
        nested.textContent===''' + json.dumps('0. ' + nested) + '''&&
        parseFloat(getComputedStyle(nested).paddingLeft)>parseFloat(getComputedStyle(first).paddingLeft)&&
        getComputedStyle(first).fontWeight==='700',count:items.length};
    ''')
    cli('resize_page', '700', '600')
    check('last_wrapped_heading_navigates', '''
      document.querySelector('.outline-item:last-child').click();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const pane=document.getElementById('writing-pane'),last=document.querySelector('.ProseMirror h6');
      const bounds=pane.getBoundingClientRect(),rect=last.getBoundingClientRect();
      return {ok:pane.scrollTop>1000&&rect.bottom>bounds.top&&rect.top<bounds.bottom&&
        document.querySelector('.outline-item:last-child').getAttribute('aria-current')==='true',scrollTop:pane.scrollTop};
    ''')
    cli('resize_page', '1512', '845')
    cli('take_screenshot', '--filePath', str(OUT / 'outline_wrapping.png'))
    (OUT / 'outline_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
