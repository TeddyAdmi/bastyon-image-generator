(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const ready = () => document.documentElement.dataset.miyaRuntimeReady = '1';

  function showView(view) {
    document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    const target = $(view + 'View');
    const tab = document.querySelector('.tab[data-view="' + view + '"]');
    if (target) target.classList.add('active');
    if (tab) tab.classList.add('active');
  }

  function selectModel(btn) {
    const id = btn.dataset.videoModel;
    if (!id) return;
    document.querySelectorAll('#videoModels .ratio').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    try { localStorage.setItem('miyaVideoModel', id); } catch {}
    const map = {
      h3: ['MiniMax H3 · I2V + Audio', 'Hugging Face ZeroGPU', '● Подключена · Image → Video + Audio'],
      wan22: ['Wan 2.2 I2V Lightning · 4 steps', 'Hugging Face ZeroGPU', '● Fallback · Image → Video'],
      'pixelster-motion': ['Motion synthesis', 'AHM7 PixelSter', '● Дополнительный маршрут · Image → Video']
    }[id];
    if (!map) return;
    if ($('videoModelName')) $('videoModelName').textContent = map[0];
    if ($('videoModelProvider')) $('videoModelProvider').textContent = 'Провайдер: ' + map[1];
    if ($('videoModelStatus')) $('videoModelStatus').textContent = map[2];
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Не удалось прочитать файл.'));
      r.readAsDataURL(file);
    });
  }

  function putImage(targetId, emptyId, url) {
    const img = $(targetId), empty = $(emptyId);
    if (!img) return;
    if (url) {
      img.src = url;
      img.classList.remove('hidden');
      if (empty) empty.classList.add('hidden');
    }
  }

  async function fallbackGenerate() {
    const p = $('genPrompt')?.value.trim();
    const err = $('genError');
    if (!p) { if (err) { err.textContent = 'Введите промпт или нажмите «Идеи».'; err.classList.add('show'); } return; }
    const b = $('generateBtn'); if (b) b.disabled = true;
    try {
      const r = await fetch('/api/generate', {
        method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({prompt:p,ratio:document.querySelector('#genRatios .active')?.dataset.ratio || '16:9',model:'auto',quality:'auto',size:'auto',outputFormat:'png'})
      });
      const d = await r.json();
      if (!r.ok || !d.imageUrl) throw new Error(d.error || ('HTTP '+r.status));
      const state = window.__MIYA_FALLBACK_STATE ||= {};
      state.image = d.imageUrl;
      putImage('genImage','genEmpty',d.imageUrl);
      $('openEditor')?.classList.remove('hidden');
      $('openVideo')?.classList.remove('hidden');
    } catch(e) {
      if (err) { err.textContent = e.message || String(e); err.classList.add('show'); }
    } finally { if (b) b.disabled = false; }
  }

  function openVideo(source) {
    if (!source) return;
    const s = window.__MIYA_FALLBACK_STATE ||= {};
    s.image = source;
    putImage('videoImage','videoEmpty',source);
    $('videoResult')?.classList.add('hidden');
    showView('video');
  }

  function bind() {
    document.querySelectorAll('.tab[data-view]').forEach(b => b.onclick = () => showView(b.dataset.view));
    document.querySelectorAll('#videoModels [data-video-model]').forEach(b => b.onclick = () => selectModel(b));

    document.querySelectorAll('#genRatios .ratio').forEach(b => b.onclick = () => {
      document.querySelectorAll('#genRatios .ratio').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    });
    document.querySelectorAll('#editRatios .ratio').forEach(b => b.onclick = () => {
      document.querySelectorAll('#editRatios .ratio').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    });
    document.querySelectorAll('#videoRatios .ratio').forEach(b => b.onclick = () => {
      document.querySelectorAll('#videoRatios .ratio').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    });

    $('generateBtn')?.addEventListener('click', () => {
      if (typeof window.runGenerate === 'function') window.runGenerate();
      else fallbackGenerate();
    });

    $('openVideo')?.addEventListener('click', () => {
      const s = window.__MIYA_FALLBACK_STATE || {};
      const src = s.image || $('genImage')?.src || '';
      if (typeof window.openVideo === 'function') window.openVideo(src);
      else openVideo(src);
    });

    $('editorAnimate')?.addEventListener('click', () => {
      const src = $('editorSource')?.src || '';
      if (typeof window.openVideo === 'function') window.openVideo(src);
      else openVideo(src);
    });

    ['videoChoose','videoChooseSide','videoReplace'].forEach(id => {
      $(id)?.addEventListener('click', () => $('videoFile')?.click());
    });
    $('editorChoose')?.addEventListener('click', () => $('editorFile')?.click());

    $('videoFile')?.addEventListener('change', async e => {
      const f = e.target.files?.[0]; if (!f) return;
      const data = await readFile(f);
      const s = window.__MIYA_FALLBACK_STATE ||= {};
      s.videoImage = data;
      putImage('videoImage','videoEmpty',data);
    });
    $('editorFile')?.addEventListener('change', async e => {
      const f = e.target.files?.[0]; if (!f) return;
      const data = await readFile(f);
      putImage('editorSource','editEmpty',data);
      const s = window.__MIYA_FALLBACK_STATE ||= {};
      s.editorImage = data;
    });

    let saved = null;
    try { saved = localStorage.getItem('miyaVideoModel'); } catch {}
    if (!['h3','wan22','pixelster-motion'].includes(saved)) saved = 'h3';
    const modelBtn = document.querySelector('#videoModels [data-video-model="' + saved + '"]');
    if (modelBtn) selectModel(modelBtn);

    ready();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once:true});
  else bind();
})();