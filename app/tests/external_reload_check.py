#!/usr/bin/env python3
"""验证外部更新的事务保护、阅读位置、源码和预览刷新。"""
import json

from browser_check import OUT, check, cli, load, results


def reload(content, baseline, doc='external-reload'):
    return 'await window.__livemark.handlers.get("file.reloadIfClean")(' + json.dumps({
        'documentID': doc, 'content': content, 'expectedContent': baseline,
    }) + ')'


if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    before = '# 原文\n\n' + '\n\n'.join('原段落'+str(i) for i in range(90)) + '\n'
    after = before.replace('原文', '外部新版').replace('原段落', '新段落')
    load(before, 'external-reload')
    check('clean_reload_preserves_document_and_scroll', '''
      const pane=document.querySelector('#writing-pane');pane.scrollTop=900;
      const previous=pane.scrollTop;
      const result=%s;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const saved=await window.__livemark.handlers.get('file.save')();
      return {ok:result.reloaded&&saved.content===%s&&!saved.dirty&&saved.documentID==='external-reload'
        &&Math.abs(pane.scrollTop-previous)<5,scroll:pane.scrollTop};
    ''' % (reload(after, before), json.dumps(after)))
    check('stale_document_reload_rejected', '''
      const result=%s;
      return {ok:!result.reloaded&&result.reason==='documentChanged'
        &&(await window.__livemark.handlers.get('file.save')()).content===%s};
    ''' % (reload('stale', after, 'previous-document'), json.dumps(after)))
    check('stale_baseline_reload_rejected', '''
      const result=%s;
      return {ok:!result.reloaded&&result.reason==='baseline'};
    ''' % reload('stale', before))
    check('clean_reload_resets_old_undo_history', '''
      await window.__livemark.handlers.get('editor.command')({command:'undo'});
      return {ok:(await window.__livemark.handlers.get('file.save')()).content===%s};
    ''' % json.dumps(after))
    cli('type_text', '本地未保存')
    check('dirty_reload_preserves_local_changes', '''
      const before=await window.__livemark.handlers.get('file.save')();
      const result=%s;
      const saved=await window.__livemark.handlers.get('file.save')();
      return {ok:before.dirty&&!result.reloaded&&result.reason==='dirty'
        &&saved.content===before.content&&saved.dirty};
    ''' % reload('# 另一个磁盘版本\n', after))
    check('conflict_banner_is_document_scoped', '''
      window.__livemark.dispatch({__livemark:1,type:'event',name:'file.externalChange',data:{documentID:'external-reload',changed:true}});
      const visible=!document.querySelector('#external-change-bar').hidden;
      window.__livemark.dispatch({__livemark:1,type:'event',name:'file.externalChange',data:{documentID:'wrong',changed:false}});
      const retained=!document.querySelector('#external-change-bar').hidden;
      window.__livemark.dispatch({__livemark:1,type:'event',name:'file.externalChange',data:{documentID:'external-reload',changed:false}});
      return {ok:visible&&retained&&document.querySelector('#external-change-bar').hidden};
    ''')
    check('conflict_actions_use_inline_controls', '''
      const bridge=window.__livemark,previous=bridge.transport,calls=[];
      bridge.transport={messageHandlers:{livemark:{postMessage:message=>{
        if(message.type!=='call')return;
        calls.push(message);
        queueMicrotask(()=>bridge.dispatch({__livemark:1,type:'response',id:message.id,ok:true,data:{}}));
      }}}};
      for(const id of ['reload-from-disk','overwrite-disk','save-conflict-copy'])document.getElementById(id).click();
      await new Promise(r=>setTimeout(r,0));bridge.transport=previous;
      return {ok:calls.length===3&&calls.every(c=>c.handler==='file.reloadFromDisk'&&c.data.documentID==='external-reload')
        &&calls.map(c=>c.data.action).join(',')==='reload,overwrite,saveAs'};
    ''')
    load(before, 'source-reload')
    check('source_mode_receives_external_update', '''
      await window.__livemark.handlers.get('editor.command')({command:'source'});
      const result=%s;
      return {ok:result.reloaded&&document.querySelector('#app').dataset.mode==='source'
        &&document.querySelector('.cm-content').textContent.includes('外部新版')
        &&!(await window.__livemark.handlers.get('file.save')()).dirty};
    ''' % reload(after, before, 'source-reload'))
    cli('type_text', '源码未保存')
    check('dirty_source_mode_is_protected', '''
      const before=await window.__livemark.handlers.get('file.save')();
      const result=%s;
      return {ok:before.dirty&&!result.reloaded
        &&(await window.__livemark.handlers.get('file.save')()).content===before.content};
    ''' % reload('# 不覆盖源码\n', after, 'source-reload'))
    load(before, 'preview-reload')
    check('preview_mode_updates_without_losing_position', '''
      await window.__livemark.handlers.get('editor.command')({command:'preview'});
      await new Promise(r=>setTimeout(r,200));
      const pane=document.querySelector('#preview-pane');pane.scrollTop=900;
      const previous=pane.scrollTop;
      const result=%s;
      await new Promise(r=>setTimeout(r,300));
      return {ok:result.reloaded&&document.querySelector('#app').dataset.mode==='preview'
        &&document.querySelector('#preview h1').textContent==='外部新版'
        &&Math.abs(pane.scrollTop-previous)<5,scroll:pane.scrollTop};
    ''' % reload(after, before, 'preview-reload'))
    (OUT / 'external_reload_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
