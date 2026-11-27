/* Claude built-in adapter: Claude answers through the viewer's claude.ai account (sample),
   and each viewer's wardrobe lives in their own private db subtree. Falls back to this browser. */
const LOCAL_KEY = 'wardrobe-advisor-claude-v1';
let _ref = null, _mode = 'local', _writing = false, _next = null, _sampleOK = null;
const readLocal = () => { try{ return JSON.parse(localStorage.getItem(LOCAL_KEY)); }catch(e){ return null; } };
const writeLocal = json => { try{ localStorage.setItem(LOCAL_KEY, json); }catch(e){} };
function trimForCloud(s){
  const c = JSON.parse(JSON.stringify(s)); c.settings = {};
  for(const k of Object.keys(c.chats || {})) if(Array.isArray(c.chats[k]) && c.chats[k].length > 40) c.chats[k] = c.chats[k].slice(-40);
  return c;
}
async function writeCloud(json){
  _writing = true;
  try{ await _ref.set({json, savedAt:Date.now()}); }
  catch(e){
    const code = e && e.code;
    if(code === 'unavailable'){ await new Promise(r => setTimeout(r, 800 + Math.random()*800)); try{ await _ref.set({json, savedAt:Date.now()}); }catch(_){ } }
    else if(code === 'quota_exceeded' || code === 'invalid_argument'){ if(typeof toast === 'function') toast('雲端儲存空間不足，請清除一些舊對話'); writeLocal(json); }
    else { _mode = 'local'; writeLocal(json); }
  }finally{
    _writing = false;
    if(_next){ const j = _next; _next = null; writeCloud(j); }
  }
}
const Adapter = {
  get headerNote(){ return _mode === 'db' ? '由 Claude 擔任顧問・資料存在你的帳號' : '由 Claude 擔任顧問・暫時只存在這個瀏覽器'; },
  get storageNote(){
    return _mode === 'db'
      ? '資料存在你自己的 Claude 帳號空間，只有你看得到，連這個頁面的擁有者也看不到。用同一個帳號在手機或電腦打開，資料都會在。'
      : '目前連不到雲端儲存（可能沒有登入），資料暫時只存在這個瀏覽器，請定期用匯出備份保存。';
  },
  canDownload: false,
  missingAI: '這個頁面現在無法使用 Claude。請確認已登入 claude.ai，第一次問問題時會跳出提示，請按允許。',
  async load(){
    let CL = window.claude;
    for(let i = 0; i < 10 && !(CL && typeof CL.use === 'function'); i++){ await new Promise(r => setTimeout(r, 100)); CL = window.claude; }
    if(!CL || typeof CL.use !== 'function'){ _sampleOK = false; return readLocal(); }
    const timeout = ms => new Promise(r => setTimeout(() => r('timeout'), ms));
    try{
      const [db, user, sample] = await Promise.all([CL.use('db'), CL.use('user'), CL.use('sample')]);
      _sampleOK = !!sample;
      const id = user ? await user.id() : null;
      if(db && id){
        _ref = db.doc('data/users/' + id + '/state');
        const snap = await Promise.race([_ref.get(), timeout(10000)]);
        if(snap && snap !== 'timeout'){
          _mode = 'db';
          if(snap.exists){ const d = snap.data(); if(d && typeof d.json === 'string') return JSON.parse(d.json); }
          return readLocal();
        }
      }
    }catch(e){ }
    _mode = 'local';
    return readLocal();
  },
  save(s){
    const json = JSON.stringify(trimForCloud(s));
    if(_mode !== 'db' || !_ref){ writeLocal(json); return; }
    if(_writing){ _next = json; return; }
    writeCloud(json);
  },
  aiReady(){ return _sampleOK !== false; },
  async chat({system, messages, images, onText}){
    const CL = window.claude;
    const sample = CL && typeof CL.use === 'function' ? await CL.use('sample') : null;
    if(!sample){ _sampleOK = false; throw new Error('這個頁面現在無法使用 Claude，請確認已登入 claude.ai。'); }
    const input = messages.map((m, i) => ({role:m.role, content: i === 0 ? `${system}\n\n===== 以下是對話 =====\n\n${m.text}` : m.text}));
    const opts = {cache:false, onText: ({text}) => { if(onText) onText(text); }};
    if(images && images.length){
      let canSee = false;
      try{ const lim = sample.limits ? await sample.limits() : null; canSee = !!(lim && lim.images); }catch(e){ canSee = false; }
      if(canSee) opts.images = images.map(x => x.blob);
      else input[input.length - 1].content += '\n\n（使用者附了照片，但這次沒辦法傳送照片。請請對方用文字描述品牌、價格、成分標籤。）';
    }
    try{ const r = await sample(input, opts); return (r && r.text) || ''; }
    catch(e){
      const code = e && e.code;
      if(code === 'not_granted'){ _sampleOK = false; throw new Error('沒有取得使用 Claude 的權限。重新整理頁面，問問題時按允許即可。'); }
      if(code === 'rate_limited') throw new Error('問得太快了，請等一下再試。');
      if(e && e.text) return e.text;
      throw new Error((e && e.message) || 'Claude 暫時沒有回應，請再試一次。');
    }
  },
  settingsHTML(){
    return `<div class="lbl">AI 模型</div><p class="hint">這個版本由 Claude 回答，使用你自己的 claude.ai 帳號，不需要 API key。想換成 GPT 或 Gemini，可以用開源版。</p>`;
  },
  bindSettings(){}
};
