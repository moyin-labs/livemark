#!/usr/bin/env python3
"""通过已配置的chrome-devtools CLI执行真实浏览器行为回归，产物写入app/.build。"""
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'app/.build/ui_validation'
OUT.mkdir(parents=True, exist_ok=True)
results = []

def cli(*args):
    if args and args[0] == 'type_text' and len(args) > 1 and args[1].startswith('-'):
        args = (args[0], '--', *args[1:])
    result = subprocess.run(['chrome-devtools', *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout

def evaluate(body):
    out = cli('evaluate_script', 'async () => {' + body + '}')
    match = re.search(r'```json\s*([\s\S]*)\s*```', out)
    if not match:
        raise RuntimeError(out)
    return json.loads(match.group(1))

def check(name, body):
    value = evaluate(body)
    results.append({'name': name, 'result': value})
    if not value.get('ok'):
        raise AssertionError(f'{name}: {value}')
    print(name, 'PASS', json.dumps(value, ensure_ascii=False))

def load(text, doc='test'):
    return evaluate('window.__events=[]; window.__livemark.transport={messageHandlers:{livemark:{postMessage:e=>window.__events.push(e)}}}; await window.__livemark.handlers.get("file.read")(' + json.dumps({'path': 'http://127.0.0.1:8766/app/tests/fixtures/ui_fixture.md', 'content': text, 'documentID': doc, 'generation': 1}) + '); return {loaded:true};')

if __name__ == '__main__':
    cli('navigate_page', '--url', 'http://127.0.0.1:8766/app/Sources/LiveMark/Resources/WebKernel/')
    fixture = (ROOT / 'app/tests/fixtures/ui_fixture.md').read_text()
    load(fixture)
    check('render_schema', 'await new Promise(r=>setTimeout(r,900)); const el=document.querySelector(".ProseMirror"); return {ok:el.querySelectorAll("table tr").length===2 && el.querySelectorAll("li.task-item").length===2 && el.querySelectorAll("input[type=checkbox]:checked").length===1 && !!el.querySelector(".katex") && !!el.querySelector(".visual-result svg") && !!el.querySelector("img[data-source]")?.naturalWidth, tables:el.querySelectorAll("table tr").length, tasks:el.querySelectorAll("li.task-item").length, diagram:!!el.querySelector(".visual-result svg")};')
    check('untouched_roundtrip', 'const saved=await window.__livemark.handlers.get("file.save")(); return {ok:saved.content===' + json.dumps(fixture) + '&&!saved.dirty, revision:saved.revision};')
    cli('take_screenshot', '--filePath', str(OUT / 'live.png'))
    check('task_toggle_and_history', 'const box=document.querySelector("li.task-item input");box.click(); const saved=await window.__livemark.handlers.get("file.save")(); await window.__livemark.handlers.get("editor.command")({command:"undo"}); const undone=await window.__livemark.handlers.get("file.save")(); return {ok:saved.content.includes("[x] 待办任务") && undone.content.includes("[ ] 待办任务") && !undone.dirty,dirty:saved.dirty};')
    check('source_mode', 'await window.__livemark.handlers.get("editor.command")({command:"source"}); return {ok:document.getElementById("app").dataset.mode==="source" && !document.getElementById("source-pane").hidden && document.getElementById("writing-pane").hidden};')
    cli('take_screenshot', '--filePath', str(OUT / 'source.png'))
    check('return_live', 'await window.__livemark.handlers.get("editor.command")({command:"live"});return {ok:!document.getElementById("writing-pane").hidden&&document.getElementById("source-pane").hidden};')
    check('new_document_history', 'await window.__livemark.handlers.get("file.read")({content:"",documentID:"new",generation:1});await window.__livemark.handlers.get("editor.command")({command:"undo"});const s=await window.__livemark.handlers.get("file.save")();return {ok:s.content===""&&!s.dirty,content:s.content};')
    load('# Anchor\n\n## 重复标题\n\nhello\n\n## 重复标题\n\nhello\n', 'anchors')
    check('unique_heading_ids', 'const ids=[...document.querySelectorAll(".ProseMirror h1,.ProseMirror h2")].map(n=>n.id);return {ok:new Set(ids).size===3&&ids[2]==="重复标题-1",ids};')
    check('search_replace', 'await window.__livemark.handlers.get("editor.command")({command:"replace"});document.getElementById("find-input").value="hello";document.getElementById("find-input").dispatchEvent(new Event("input"));document.getElementById("replace-input").value="世界";document.getElementById("replace-all").click();const s=await window.__livemark.handlers.get("file.save")();return {ok:!s.content.includes("hello")&&s.content.split("世界").length===3,content:s.content};')
    cli('take_screenshot', '--filePath', str(OUT / 'find.png'))
    check('source_undo_boundary', 'await window.__livemark.handlers.get("file.read")({content:"# New\\n",documentID:"another",generation:1});await window.__livemark.handlers.get("editor.command")({command:"undo"});return {ok:(await window.__livemark.handlers.get("file.save")()).content==="# New\\n"};')
    check('theme_switch', 'await window.__livemark.handlers.get("app.setTheme")({theme:"night"});return {ok:document.documentElement.dataset.theme==="night"&&getComputedStyle(document.body).backgroundColor==="rgb(54, 59, 64)"};')
    cli('take_screenshot', '--filePath', str(OUT / 'night.png'))
    check('export_html', 'const s=await window.__livemark.handlers.get("export.requestHtml")({standalone:true});return {ok:s.html.includes("<h1 id=\\"new\\">")&&s.html.includes("<style>"),length:s.html.length};')
    load((ROOT / 'app/tests/fixtures/long_fixture.md').read_text(), 'long')
    check('long_document_outline', 'document.querySelector(".outline-item:last-child").click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const pane=document.getElementById("writing-pane"),last=document.querySelector(".ProseMirror h2:last-of-type");const rect=last.getBoundingClientRect(),bounds=pane.getBoundingClientRect();return {ok:document.querySelectorAll(".outline-item").length===160&&pane.scrollTop>1000&&rect.bottom>bounds.top&&rect.top<bounds.bottom,outline:document.querySelectorAll(".outline-item").length,scrollTop:pane.scrollTop};')
    load('# 跳转目标\n\n' + '\n\n'.join('段落'+str(i) for i in range(100)) + '\n\n[返回标题](#跳转目标)\n', 'link')
    check('preview_anchor_navigation', 'await window.__livemark.handlers.get("editor.command")({command:"preview"});await new Promise(r=>setTimeout(r,150));const pane=document.getElementById("preview-pane");pane.scrollTop=pane.scrollHeight;document.querySelector("#preview a").click();await new Promise(r=>requestAnimationFrame(r));return {ok:pane.scrollTop<120,scrollTop:pane.scrollTop};')
    (OUT / 'browser_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
