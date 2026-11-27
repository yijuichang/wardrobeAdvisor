/* Open-source adapter: data in localStorage, AI through the user's own API key.
   Requests go straight from the browser to the provider; there is no server. */
const STORE_KEY = 'wardrobe-advisor-v1';
const PROVIDERS = {
  openai:   {label:'OpenAI（GPT）',       model:'gpt-4o-mini',       keyUrl:'https://platform.openai.com/api-keys',      keyHint:'sk-…'},
  anthropic:{label:'Anthropic（Claude）', model:'claude-sonnet-5-5', keyUrl:'https://console.anthropic.com/settings/keys', keyHint:'sk-ant-…'},
  gemini:   {label:'Google Gemini',       model:'gemini-flash-lite-latest', keyUrl:'https://aistudio.google.com/apikey',        keyHint:'AIza…'}
};

/* messages: [{role:'user'|'assistant', text}], starting and ending with 'user'.
   images: [{mime, b64}] attached to the last user message. */
function buildRequest(provider, key, model, system, messages, images){
  images = images || [];
  const last = messages.length - 1;
  if(provider === 'openai'){
    const msgs = [{role:'system', content:system}].concat(messages.map((m, i) => ({
      role: m.role,
      content: i === last && images.length
        ? [{type:'text', text:m.text}].concat(images.map(x => ({type:'image_url', image_url:{url:`data:${x.mime};base64,${x.b64}`}})))
        : m.text
    })));
    return {url:'https://api.openai.com/v1/chat/completions',
      init:{method:'POST', headers:{'Content-Type':'application/json', 'Authorization':'Bearer ' + key}, body:JSON.stringify({model, messages:msgs})}};
  }
  if(provider === 'anthropic'){
    const msgs = messages.map((m, i) => ({
      role: m.role,
      content: i === last && images.length
        ? images.map(x => ({type:'image', source:{type:'base64', media_type:x.mime, data:x.b64}})).concat([{type:'text', text:m.text}])
        : m.text
    }));
    return {url:'https://api.anthropic.com/v1/messages',
      init:{method:'POST', headers:{'Content-Type':'application/json', 'x-api-key':key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model, max_tokens:2048, system, messages:msgs})}};
  }
  if(provider === 'gemini'){
    const contents = messages.map((m, i) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: (i === last ? images.map(x => ({inline_data:{mime_type:x.mime, data:x.b64}})) : []).concat([{text:m.text}])
    }));
    return {url:`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      init:{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({systemInstruction:{parts:[{text:system}]}, contents})}};
  }
  throw new Error('不支援的 AI 供應商');
}
function parseReply(provider, j){
  if(provider === 'openai') return j && j.choices && j.choices[0] && j.choices[0].message ? (j.choices[0].message.content || '') : '';
  if(provider === 'anthropic') return j && Array.isArray(j.content) ? j.content.filter(b => b.type === 'text').map(b => b.text).join('') : '';
  if(provider === 'gemini'){
    const c = j && j.candidates && j.candidates[0];
    if(!c && j && j.promptFeedback && j.promptFeedback.blockReason) return '（這次的內容被 Gemini 的安全設定擋下了，換個說法再試一次。）';
    return c && c.content && Array.isArray(c.content.parts) ? c.content.parts.map(p => p.text || '').join('') : '';
  }
  return '';
}
function friendlyError(provider, status, j){
  const label = PROVIDERS[provider] ? PROVIDERS[provider].label : provider;
  const raw = j && j.error ? (typeof j.error === 'string' ? j.error : j.error.message) : '';
  const tail = raw ? `（${raw}）` : '';
  if(status === 401 || status === 403) return `${label}：API key 不正確、已失效，或沒有這個模型的權限。${tail}`;
  if(status === 400 && /api key/i.test(raw)) return `${label}：API key 不正確，請重新複製一次。${tail}`;
  if(status === 404) return `${label}：找不到這個模型名稱，請到設定改成供應商目前提供的模型。${raw ? '（' + raw + '）' : ''}`;
  if(status === 429) return `${label}：超過用量限制或免費額度用完，請稍後再試，或換一個比較輕量的模型。${tail}`;
  return `${label} 回應錯誤（${status}）${raw ? '：' + raw : ''}`;
}

const Adapter = {
  headerNote: '資料只存在這個瀏覽器',
  storageNote: '所有資料（包括 API key）只存在這台裝置的瀏覽器，不會上傳到任何伺服器。問顧問時，請求會從你的瀏覽器直接送到你選的 AI 供應商。換裝置或換瀏覽器時，用匯出、匯入搬資料。',
  canDownload: true,
  missingAI: '先到右上角「設定」選一個 AI 供應商，並填入你自己的 API key，就可以開始問。',
  async load(){ try{ return JSON.parse(localStorage.getItem(STORE_KEY)); }catch(e){ return null; } },
  save(s){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
    catch(e){ if(typeof toast === 'function') toast('儲存失敗：瀏覽器空間不足，可以先清除舊對話'); }
  },
  aiReady(s){ const st = s.settings || {}; return !!(st.provider && PROVIDERS[st.provider] && st.keys && st.keys[st.provider]); },
  async chat({system, messages, images, settings, timeoutMs}){
    const st = settings || {}, provider = st.provider;
    const key = (st.keys || {})[provider], model = ((st.models || {})[provider] || PROVIDERS[provider].model).trim();
    const {url, init} = buildRequest(provider, key, model, system, messages, images);
    const wait = timeoutMs || 90000;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), wait);
    let res, j = null;
    try{ res = await fetch(url, Object.assign({}, init, {signal:ctl.signal})); }
    catch(e){ throw new Error(e && e.name === 'AbortError'
      ? `${Math.round(wait/1000)} 秒內沒有回應。可能是模型「${model}」太慢或目前不開放給你的帳號，試試換成預設的 ${PROVIDERS[provider].model}。`
      : `連不到 ${PROVIDERS[provider].label}，請檢查網路連線。`); }
    finally{ clearTimeout(timer); }
    try{ j = await res.json(); }catch(e){ j = null; }
    if(!res.ok) throw new Error(friendlyError(provider, res.status, j));
    return parseReply(provider, j);
  },
  settingsHTML(s){
    const st = s.settings || {}, p = st.provider || 'openai';
    return `<div class="lbl">AI 模型</div><p class="hint">用你自己的 API key，費用由供應商直接向你收取。key 只存在這個瀏覽器。</p>
    <label for="prov">供應商</label><select id="prov">${Object.entries(PROVIDERS).map(([k,v]) => `<option value="${k}"${k===p?' selected':''}>${esc(v.label)}</option>`).join('')}</select>
    <label for="akey">API key</label><input id="akey" type="password" autocomplete="off" spellcheck="false">
    <p class="hint">還沒有 key？到 <a id="keylink" target="_blank" rel="noopener noreferrer"></a> 申請。</p>
    <label for="amodel">模型名稱</label><input id="amodel" autocomplete="off" spellcheck="false">
    <p class="hint">預設值可能會過時，可以改成供應商目前提供、而且看得懂照片的模型。</p>
    <div class="row" style="margin-top:10px"><button class="btn" id="atest" type="button">測試連線</button><span class="small" id="ares" role="status"></span></div>`;
  },
  bindSettings(d, s, save){
    const st = s.settings = s.settings || {}; st.keys = st.keys || {}; st.models = st.models || {};
    if(!st.provider) st.provider = 'openai';
    const prov = d.querySelector('#prov'), key = d.querySelector('#akey'), model = d.querySelector('#amodel'), link = d.querySelector('#keylink');
    const fill = () => {
      const p = prov.value, info = PROVIDERS[p];
      key.value = st.keys[p] || ''; key.placeholder = info.keyHint;
      model.value = st.models[p] || info.model; model.placeholder = info.model;
      link.href = info.keyUrl; link.textContent = info.keyUrl.replace('https://','');
    };
    fill();
    prov.onchange = () => { st.provider = prov.value; fill(); save(); };
    key.oninput = () => { st.keys[prov.value] = key.value.trim(); save(); };
    model.oninput = () => { st.models[prov.value] = model.value.trim(); save(); };
    d.querySelector('#atest').onclick = async () => {
      const out = d.querySelector('#ares');
      if(!st.keys[prov.value]){ out.textContent = '請先填入 API key'; return; }
      const btn = d.querySelector('#atest'); btn.disabled = true;
      const t0 = Date.now(); out.textContent = '測試中…';
      const tick = setInterval(() => { out.textContent = `測試中… ${Math.round((Date.now() - t0)/1000)} 秒`; }, 1000);
      try{ const r = await Adapter.chat({system:'Reply with the single word OK.', messages:[{role:'user', text:'ping'}], images:[], settings:st, timeoutMs:20000});
        out.textContent = r ? `連線成功 ✓（${((Date.now() - t0)/1000).toFixed(1)} 秒）` : '有回應，但內容是空的'; }
      catch(e){ out.textContent = e.message; }
      finally{ clearInterval(tick); btn.disabled = false; }
    };
  }
};
