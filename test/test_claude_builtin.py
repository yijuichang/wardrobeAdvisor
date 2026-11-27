import os
import pathlib, json
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
url = (root/'claude-builtin/index.html').as_uri()
MOCK = r"""
window.__store = JSON.parse(localStorage.getItem('__mockdb') || '{}'); window.__calls = [];
const db = {doc(path){ return {
  async get(){ const d = window.__store[path]; return {exists: !!d, data: () => d}; },
  async set(v){ window.__store[path] = v; localStorage.setItem('__mockdb', JSON.stringify(window.__store)); } }; }};
const user = {async id(){ return 'u123'; }};
const sample = async (input, opts) => { window.__calls.push({input, images:(opts.images||[]).length});
  opts.onText && opts.onText({text:'**建議**', delta:''});
  return {text:'**跳過。** 你已經有類似的。\n\n```wardrobe-actions\n[{"type":"add_wish","name":"炭灰色羊毛西裝褲","category":"褲子","priority":1}]\n```'}; };
sample.limits = async () => ({images:true});
window.claude = {use: async n => ({db, user, sample})[n] || null};
"""
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}))
    pg = b.new_page(viewport={'width':390,'height':844})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.add_init_script(MOCK)
    pg.goto(url); pg.wait_for_timeout(400)
    assert pg.locator('.banner').count() == 0, 'AI should be ready'
    pg.click('.tab[data-t=closet]'); pg.click('[data-act=example]'); pg.wait_for_timeout(900)
    store = pg.evaluate('window.__store'); assert 'data/users/u123/state' in store, store.keys()
    pg.click('.tab[data-t=advisor]')
    pg.set_input_files('#filePick', str(root/'test/shirt.png')); pg.wait_for_selector('.thumbs img')
    pg.fill('#ask','這條褲子 $30 值得嗎'); pg.click('[data-act=send]'); pg.wait_for_selector('[data-apply]')
    calls = pg.evaluate('window.__calls'); c = calls[-1]
    assert c['images'] == 1 and c['input'][0]['content'].startswith('你是') and c['input'][-1]['role'] == 'user'
    pg.click('[data-apply="1:0"]'); pg.wait_for_timeout(900)
    pg.click('#openSettings'); note = pg.inner_text('.dlg'); assert '只有你看得到' in note and 'API key' in note
    pg.click('.dlg .foot .btn.pri')
    st = json.loads(pg.evaluate('window.__store')['data/users/u123/state']['json'])
    assert '炭灰色羊毛西裝褲' in [w['name'] for w in st['profiles'][0]['wishlist']]
    saved = pg.evaluate('JSON.stringify(window.__store)')
    pg.add_init_script('localStorage.setItem("__mockdb", ' + json.dumps(saved) + '); window.__store = JSON.parse(' + json.dumps(saved) + ');')
    pg.reload(); pg.wait_for_function("!document.querySelector('main').textContent.includes('載入中')"); pg.wait_for_timeout(300)
    pg.click('.tab[data-t=wish]'); assert '炭灰色羊毛西裝褲' in pg.inner_text('main'), 'not persisted to db'
    pg.screenshot(path=str(root/'test/out/07-claude-wish.png'))
    # no runtime at all -> falls back to local, shows banner
    pg2 = b.new_page(); pg2.on('pageerror', lambda e: errors.append(str(e))); pg2.goto(url); pg2.wait_for_timeout(1500)
    assert pg2.locator('.banner').count() == 1
    b.close()
print('errors:', errors); print('ALL PASSED' if not errors else 'PAGE ERRORS')
