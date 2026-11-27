import os
import json, base64, pathlib, sys
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
url = (root/'index.html').as_uri()
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==')
(root/'test/shirt.png').write_bytes(png)
FENCE='```'
reply = ("**可以買。** 淺藍素面是你最缺的。\n\n- 100% 棉\n- 配深藍外套對比好\n\n"
         f"{FENCE}wardrobe-actions\n[{{\"type\":\"add_item\",\"category\":\"襯衫\",\"name\":\"淺藍牛津襯衫\",\"color\":\"淺藍\",\"brand\":\"BR Factory\",\"material\":\"100% 棉\"}},"
         "{\"type\":\"set_brand\",\"name\":\"COS\",\"stance\":\"like\",\"notes\":\"試穿很合身\"}]\n" + FENCE)
seen = {}
def handler(route, request):
    host = request.url.split('/')[2]
    body = json.loads(request.post_data)
    seen[host] = {'url': request.url, 'headers': request.headers, 'body': body}
    if 'openai' in host: out = {'choices':[{'message':{'content':reply}}]}
    elif 'anthropic' in host: out = {'content':[{'type':'text','text':reply}]}
    else: out = {'candidates':[{'content':{'parts':[{'text':reply}]}}]}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(out), headers={'Access-Control-Allow-Origin':'*'})
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}))
    pg = b.new_page(viewport={'width':390,'height':844})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.route('https://api.openai.com/**', handler); pg.route('https://api.anthropic.com/**', handler); pg.route('https://generativelanguage.googleapis.com/**', handler)
    pg.goto(url); pg.wait_for_timeout(300)
    assert '設定' in pg.inner_text('.banner'), 'banner missing'
    pg.screenshot(path=str(root/'test/out/01-empty.png'), full_page=True)
    # load example
    pg.click('#openSettings'); pg.click('#ex'); pg.click('#ok'); pg.wait_for_timeout(200)
    txt = pg.inner_text('main'); assert '深藍色休閒西裝外套' in txt and '共 12 件' in txt, txt[:200]
    pg.screenshot(path=str(root/'test/out/02-closet.png'), full_page=True)
    # search (only list updates, input keeps focus)
    pg.fill('#q', 'Uniqlo'); pg.wait_for_timeout(100)
    assert '白色牛津襯衫' in pg.inner_text('#closetList') and '樂福鞋' not in pg.inner_text('#closetList')
    pg.fill('#q', '')
    # wishlist + brands + prefs render
    for t, word in [('wish','炭灰色西裝褲'),('brands','Muji'),('prefs','襯衫 M')]:
        pg.click(f'.tab[data-t={t}]'); pg.wait_for_timeout(100)
        assert word in (pg.inner_text('main') + ''.join(pg.eval_on_selector_all('textarea', 'els=>els.map(e=>e.value)'))), t
    pg.click('.tab[data-t=wish]'); pg.screenshot(path=str(root/'test/out/03-wish.png'), full_page=True)
    # configure each provider and chat
    for prov, model_default in [('openai','gpt-4o-mini'),('anthropic','claude-sonnet-5-5'),('gemini','gemini-flash-lite-latest')]:
        pg.click('#openSettings'); pg.select_option('#prov', prov); pg.fill('#akey', 'test-key-'+prov)
        assert pg.input_value('#amodel') == model_default
        pg.click('#atest'); pg.wait_for_function("document.querySelector('#ares').textContent.includes('成功')")
        pg.click('.dlg .foot .btn.pri')
    # send a message with a photo through gemini (last chosen)
    pg.click('.tab[data-t=advisor]')
    pg.set_input_files('#filePick', str(root/'test/shirt.png')); pg.wait_for_selector('.thumbs img')
    pg.fill('#ask', '這件 $24 值得買嗎？')
    pg.click('[data-act=send]'); pg.wait_for_selector('[data-apply]')
    g = seen['generativelanguage.googleapis.com']['body']
    assert 'inline_data' in json.dumps(g) and g['systemInstruction']['parts'][0]['text'].startswith('你是'), 'gemini shape'
    assert '深藍色休閒西裝外套' in g['systemInstruction']['parts'][0]['text']
    pg.screenshot(path=str(root/'test/out/04-chat.png'), full_page=True)
    assert 'wardrobe-actions' not in pg.inner_text('.msgs'), 'action block leaked'
    pg.click('[data-applyall]'); pg.wait_for_timeout(100)
    assert '已套用' in pg.inner_text('.msgs')
    pg.click('.tab[data-t=closet]'); assert '淺藍牛津襯衫' in pg.inner_text('main')
    pg.click('.tab[data-t=brands]'); assert '試穿很合身' in pg.inner_text('main')
    # anthropic + openai request shapes with image
    for prov in ['anthropic','openai']:
        pg.click('#openSettings'); pg.select_option('#prov', prov); pg.click('.dlg .foot .btn.pri')
        pg.click('.tab[data-t=advisor]'); pg.set_input_files('#filePick', str(root/'test/shirt.png')); pg.wait_for_selector('.thumbs img')
        pg.fill('#ask', '再看一次'); pg.click('[data-act=send]'); pg.wait_for_timeout(400)
    a = seen['api.anthropic.com']
    assert a['headers'].get('anthropic-dangerous-direct-browser-access') == 'true' and a['headers'].get('x-api-key') == 'test-key-anthropic'
    roles = [m['role'] for m in a['body']['messages']]
    assert roles[0] == 'user' and roles[-1] == 'user' and all(roles[i] != roles[i+1] for i in range(len(roles)-1)), roles
    assert a['body']['messages'][-1]['content'][0]['type'] == 'image'
    o = seen['api.openai.com']
    assert o['headers']['authorization'] == 'Bearer test-key-openai' and o['body']['messages'][0]['role'] == 'system'
    assert o['body']['messages'][-1]['content'][1]['type'] == 'image_url'
    # persistence + export excludes keys
    pg.reload(); pg.wait_for_timeout(300)
    assert pg.locator('.msg').count() >= 6, ('chat not persisted', pg.locator('.msg').count())
    pg.click('#openSettings'); pg.click('#exp'); ex = pg.input_value('#ej')
    assert 'test-key' not in ex and '淺藍牛津襯衫' in ex
    pg.click('.dlg .foot [data-close]')
    # delete + undo
    pg.click('.tab[data-t=wish]'); n0 = pg.locator('.tag').count(); pg.locator('[data-del]').first.click(); assert pg.locator('.tag').count() == n0-1
    pg.click('.toast button'); assert pg.locator('.tag').count() == n0
    # error path
    pg.unroute('https://api.openai.com/**')
    pg.route('https://api.openai.com/**', lambda r, q: r.fulfill(status=401, content_type='application/json', body='{"error":{"message":"bad key"}}', headers={'Access-Control-Allow-Origin':'*'}))
    pg.click('.tab[data-t=advisor]'); pg.fill('#ask','hi'); pg.click('[data-act=send]'); pg.wait_for_timeout(300)
    assert 'API key 不正確' in pg.inner_text('.msgs')
    # test-connection timeout: a provider that never answers stops after ~20 s with a reason
    pg.unroute('https://api.anthropic.com/**'); pg.route('https://api.anthropic.com/**', lambda r, q: None)
    pg.click('#openSettings'); pg.select_option('#prov','anthropic'); pg.click('#atest')
    pg.wait_for_function("document.querySelector('#ares').textContent.includes('秒')"); assert '測試中' in pg.inner_text('#ares')
    pg.wait_for_function("document.querySelector('#ares').textContent.includes('沒有回應')", timeout=30000)
    pg.click('.dlg .foot .btn.pri')
    # desktop + dark
    pg.set_viewport_size({'width':1100,'height':800}); pg.emulate_media(color_scheme='dark'); pg.wait_for_timeout(100)
    pg.screenshot(path=str(root/'test/out/05-desktop-dark.png'))
    pg.click('.tab[data-t=closet]'); pg.screenshot(path=str(root/'test/out/06-closet-dark.png'))
    sw = pg.evaluate('document.documentElement.scrollWidth'); 
    b.close()
print('errors:', errors)
print('ALL PASSED' if not errors else 'PAGE ERRORS')
