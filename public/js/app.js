/* ─── fpeds — app.js ─── */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     UPDATE LOG MODAL
  ══════════════════════════════════════════ */
  const CURRENT_VERSION = '1.3';
  const seenKey = 'fpeds_seen_version';

  const modal      = document.getElementById('update-modal');
  const modalClose = document.getElementById('modal-close');

  function checkUpdateModal() {
    const seen = localStorage.getItem(seenKey);
    if (seen !== CURRENT_VERSION) {
      modal.classList.remove('hidden');
    }
  }

  modalClose.addEventListener('click', () => {
    modal.classList.add('hidden');
    localStorage.setItem(seenKey, CURRENT_VERSION);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
      localStorage.setItem(seenKey, CURRENT_VERSION);
    }
  });

  checkUpdateModal();

  /* ══════════════════════════════════════════
     USER INFO + LOGOUT
  ══════════════════════════════════════════ */
  const userNameEl  = document.getElementById('user-name');
  const logoutBtn   = document.getElementById('logout-btn');

  fetch('/fpeds/me').then(r => r.json()).then(d => {
    if (d.username) userNameEl.textContent = d.username;
  }).catch(() => {});

  logoutBtn.addEventListener('click', async () => {
    await fetch('/fpeds/logout', { method: 'POST' });
    window.location.href = '/fpeds/login';
  });

  /* ══════════════════════════════════════════
     TAB SWITCHING
  ══════════════════════════════════════════ */
  const navBtns   = document.querySelectorAll('.nav-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      navBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + target).classList.add('active');
    });
  });

  /* ══════════════════════════════════════════
     SHARED HELPERS
  ══════════════════════════════════════════ */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function httpCodeClass(code) {
    if (!code) return '';
    if (code >= 200 && code < 300) return 'code-2xx';
    if (code >= 300 && code < 400) return 'code-3xx';
    if (code >= 400 && code < 500) return 'code-4xx';
    return 'code-5xx';
  }

  function statusMeta(status) {
    const map = {
      active:          { label:'ACTIVE',    cls:'badge-active',   dotCls:'s-active'   },
      inactive:        { label:'INACTIVE',  cls:'badge-inactive', dotCls:'s-inactive' },
      dead:            { label:'DEAD',      cls:'badge-dead',     dotCls:'s-dead'     },
      tor_unavailable: { label:'TOR REQ',   cls:'badge-tor',      dotCls:'s-tor'      },
      error:           { label:'ERROR',     cls:'badge-error',    dotCls:'s-dead'     },
    };
    return map[status] || { label:'UNKNOWN', cls:'badge-error', dotCls:'s-dead' };
  }

  function parseUrls(raw) {
    const tokens = raw.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    return [...new Set(tokens)].map(u => /^https?:\/\//i.test(u) ? u : 'http://' + u);
  }

  function ts() {
    const n = new Date();
    return [n.getHours(), n.getMinutes(), n.getSeconds()].map(v => String(v).padStart(2,'0')).join(':');
  }

  /* ══════════════════════════════════════════
     CHECK TAB
  ══════════════════════════════════════════ */
  const urlInput       = document.getElementById('url-input');
  const checkBtn       = document.getElementById('check-btn');
  const checkCountLbl  = document.getElementById('check-count-label');
  const resultsWrap    = document.getElementById('check-results-wrap');
  const resultsList    = document.getElementById('check-results-list');
  const resultsSummary = document.getElementById('results-summary');
  const clearResultsBtn= document.getElementById('clear-results');
  const historyList    = document.getElementById('history-list');
  const clearHistBtn   = document.getElementById('clear-history');

  let checkHistory = JSON.parse(localStorage.getItem('fpeds_history') || '[]');

  urlInput.addEventListener('input', () => {
    const urls = parseUrls(urlInput.value);
    checkCountLbl.textContent = urls.length > 0 ? `${urls.length} URL${urls.length > 1 ? 's' : ''}` : '';
  });

  function saveHistory() {
    localStorage.setItem('fpeds_history', JSON.stringify(checkHistory.slice(0, 60)));
  }

  function renderHistory() {
    if (checkHistory.length === 0) {
      historyList.innerHTML = '<div class="history-empty">No checks yet.</div>';
      return;
    }
    historyList.innerHTML = checkHistory.map((item, i) => {
      const m    = statusMeta(item.status);
      const code = item.httpCode ? `<span class="history-code">${item.httpCode}</span>` : '';
      return `<div class="history-item" data-index="${i}">
        <span class="history-status ${m.dotCls.replace('s-','hs-')}"></span>
        <span class="history-url" title="${escHtml(item.url)}">${escHtml(item.url)}</span>${code}
      </div>`;
    }).join('');
    historyList.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        urlInput.value = checkHistory[el.dataset.index].url;
        urlInput.dispatchEvent(new Event('input'));
        runCheck();
      });
    });
  }

  function createResultRow(data, pending = false) {
    const item = document.createElement('div');
    item.className = 'check-result-item';
    item.dataset.url = data.url;
    if (pending) {
      item.innerHTML = `
        <span class="cri-status s-pending"></span>
        <span class="cri-badge" style="color:var(--text-dimmer);border:1px solid var(--border)">PENDING</span>
        <span class="cri-code"></span>
        <span class="cri-url">${escHtml(data.url)}</span>
        <span class="cri-time"></span>`;
      return item;
    }
    const m = statusMeta(data.status);
    const codeHtml  = data.httpCode
      ? `<span class="cri-code ${httpCodeClass(data.httpCode)}">${data.httpCode}</span>`
      : `<span class="cri-code"></span>`;
    const onionHtml = data.isOnion ? `<span class="cri-onion">.onion</span> ` : '';
    item.innerHTML = `
      <span class="cri-status ${m.dotCls}"></span>
      <span class="cri-badge ${m.cls}">${m.label}</span>
      ${codeHtml}
      <span class="cri-url">${onionHtml}<a href="${escHtml(data.url)}" target="_blank" rel="noopener">${escHtml(data.url)}</a></span>
      <span class="cri-time">${data.responseTime !== undefined ? data.responseTime + 'ms' : ''}</span>`;
    return item;
  }

  function updateSummary(results) {
    const active   = results.filter(r => r.status === 'active').length;
    const inactive = results.filter(r => r.status === 'inactive').length;
    const dead     = results.filter(r => ['dead','error','tor_unavailable'].includes(r.status)).length;
    resultsSummary.innerHTML = `
      <span class="sum-item"><span class="sum-dot green"></span><span style="color:var(--green)">${active} active</span></span>
      <span class="sum-item"><span class="sum-dot yellow"></span><span style="color:var(--yellow)">${inactive} inactive</span></span>
      <span class="sum-item"><span class="sum-dot red"></span><span style="color:var(--red)">${dead} dead</span></span>`;
  }

  async function runCheck() {
    const urls = parseUrls(urlInput.value);
    if (urls.length === 0) return;

    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking…';
    resultsWrap.classList.remove('hidden');
    resultsList.innerHTML = '';
    resultsSummary.innerHTML = '';

    const rowMap  = {};
    const results = [];

    urls.forEach(url => {
      const row = createResultRow({ url }, true);
      resultsList.appendChild(row);
      rowMap[url] = row;
    });

    await Promise.allSettled(urls.map(async (url) => {
      try {
        const resp = await fetch('/fpeds/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await resp.json();
        results.push(data);
        const newRow = createResultRow(data);
        rowMap[url].replaceWith(newRow);
        rowMap[url] = newRow;
        updateSummary(results);
        checkHistory.unshift({ url: data.url || url, status: data.status, httpCode: data.httpCode });
        checkHistory = checkHistory.slice(0, 60);
        saveHistory();
        renderHistory();
      } catch (err) {
        const errData = { url, status: 'error', message: err.message };
        results.push(errData);
        const newRow = createResultRow(errData);
        rowMap[url].replaceWith(newRow);
        rowMap[url] = newRow;
        updateSummary(results);
      }
    }));

    checkBtn.disabled = false;
    checkBtn.textContent = 'Check';
  }

  checkBtn.addEventListener('click', runCheck);
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runCheck(); });
  clearResultsBtn.addEventListener('click', () => { resultsWrap.classList.add('hidden'); resultsList.innerHTML = ''; });
  clearHistBtn.addEventListener('click', () => { checkHistory = []; saveHistory(); renderHistory(); });
  renderHistory();

  /* ══════════════════════════════════════════
     SEARCH TAB
  ══════════════════════════════════════════ */
  const searchBtn      = document.getElementById('search-btn');
  const searchBtnLabel = document.getElementById('search-btn-label');
  const stopBtn        = document.getElementById('stop-btn');
  const infinityCheck  = document.getElementById('infinity-mode');
  const searchStats    = document.getElementById('search-stats');
  const statQueries    = document.getElementById('stat-queries');
  const statLinks      = document.getElementById('stat-links');
  const statPass       = document.getElementById('stat-pass');
  const consoleOutput  = document.getElementById('console-output');
  const foundSection   = document.getElementById('found-links-section');
  const foundLinksList = document.getElementById('found-links-list');
  const copyAllBtn     = document.getElementById('copy-all-btn');
  const exportBtn      = document.getElementById('export-btn');

  let evtSource   = null;
  let isSearching = false;
  let foundLinks  = [];
  let queryCount  = 0;
  let totalQ      = 60;
  let passNum     = 1;

  function conLine(el, text, cls) {
    const span = document.createElement('span');
    span.className = 'console-line ' + (cls || 'c-dim');
    span.innerHTML = text;
    el.appendChild(span);
    while (el.children.length > 900) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  function clearSearch() {
    consoleOutput.innerHTML = '';
    foundLinksList.innerHTML = '';
    foundLinks  = [];
    queryCount  = 0;
    passNum     = 1;
    statQueries.textContent = `0/${totalQ}`;
    statLinks.textContent   = '0';
    statPass.textContent    = '1';
  }

  function addFoundLink(url, name) {
    if (foundLinks.find(l => l.url === url)) return;
    foundLinks.push({ url, name });
    statLinks.textContent = foundLinks.length;

    const item = document.createElement('div');
    item.className = 'found-link-item';
    item.innerHTML = `
      <span class="found-link-dot"></span>
      <span class="found-link-name" title="${escHtml(name)}">${escHtml(name)}</span>
      <span class="found-link-url" title="${escHtml(url)}">${escHtml(url)}</span>
      <span class="found-link-actions">
        <button class="link-action-btn btn-open">Open</button>
        <button class="link-action-btn btn-copy-link">Copy</button>
        <button class="link-action-btn btn-check-link">Check</button>
      </span>`;
    item.querySelector('.btn-open').addEventListener('click', () => window.open(url, '_blank', 'noopener'));
    item.querySelector('.btn-copy-link').addEventListener('click', () => navigator.clipboard.writeText(url).catch(() => {}));
    item.querySelector('.btn-check-link').addEventListener('click', () => {
      urlInput.value = url;
      urlInput.dispatchEvent(new Event('input'));
      document.querySelector('[data-tab="check"]').click();
      runCheck();
    });
    foundLinksList.appendChild(item);
    foundSection.classList.remove('hidden');
  }

  function startSearch() {
    if (isSearching) return;
    isSearching = true;
    clearSearch();
    searchBtn.disabled = true;
    searchBtnLabel.textContent = 'Scanning…';
    stopBtn.classList.remove('hidden');
    searchStats.classList.remove('hidden');

    const infinity = infinityCheck.checked;
    evtSource = new EventSource('/fpeds/search?fast=1' + (infinity ? '&infinity=1' : ''));

    evtSource.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'start') {
        totalQ = d.total || 60;
        conLine(consoleOutput, `[${ts()}] ${escHtml(d.message)}`, 'c-init');
      }
      if (d.type === 'pass') {
        passNum = d.pass;
        statPass.textContent = passNum;
        queryCount = 0;
        if (passNum > 1) conLine(consoleOutput, `[${ts()}] ── Pass ${passNum} — cycling through new links ───────────`, 'c-dim');
      }
      if (d.type === 'query') {
        queryCount++;
        statQueries.textContent = `${queryCount}/${totalQ}`;
        conLine(consoleOutput, `[${ts()}] ${escHtml(d.message)}`, 'c-query');
      }
      if (d.type === 'link') {
        conLine(consoleOutput, `[${ts()}]  ↳ <span style="color:var(--green)">${escHtml(d.url)}</span> <span class="c-dim">${escHtml(d.name)}</span>`, 'c-link');
        addFoundLink(d.url, d.name);
      }
      if (d.type === 'done') {
        conLine(consoleOutput, `[${ts()}] ── ${escHtml(d.message)}`, 'c-done');
        if (!infinity) stopSearch(true);
      }
    };
    evtSource.onerror = () => { if (isSearching) conLine(consoleOutput, `[${ts()}] Stream reconnecting...`, 'c-err'); };
  }

  function stopSearch(natural) {
    isSearching = false;
    if (evtSource) { evtSource.close(); evtSource = null; }
    searchBtn.disabled = false;
    searchBtnLabel.textContent = 'Start Scan';
    stopBtn.classList.add('hidden');
    if (!natural) conLine(consoleOutput, `[${ts()}] Scan stopped.`, 'c-err');
  }

  searchBtn.addEventListener('click', startSearch);
  stopBtn.addEventListener('click',   () => stopSearch(false));

  copyAllBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(foundLinks.map(l => l.url).join('\n')).then(() => {
      copyAllBtn.textContent = 'Copied!';
      setTimeout(() => { copyAllBtn.textContent = 'Copy All'; }, 1500);
    }).catch(() => {});
  });

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([foundLinks.map(l => `${l.name}\t${l.url}`).join('\n')], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'fpeds_chatrooms.txt' });
    a.click(); URL.revokeObjectURL(a.href);
  });


  /* ══════════════════════════════════════════
     OSN | SEARCH TAB (OSINT)
  ══════════════════════════════════════════ */
  const osintInput      = document.getElementById('osint-input');
  const osintTypeBadge  = document.getElementById('osint-type-badge');
  const osintBtn        = document.getElementById('osint-btn');
  const osintStopBtn    = document.getElementById('osint-stop-btn');
  const osintLive       = document.getElementById('osint-live');
  const osintPhaseLabel = document.getElementById('osint-phase-label');
  const osintPhaseFill  = document.getElementById('osint-phase-fill');
  const osintPhasePct   = document.getElementById('osint-phase-pct');
  const osintConsoleLbl = document.getElementById('osint-console-lbl');
  const osintSrcCount   = document.getElementById('osint-src-count');
  const osintOutput     = document.getElementById('osint-output');
  const osintPlatWrap   = document.getElementById('osint-platform-grid-wrap');
  const osintPlatGrid   = document.getElementById('osint-platform-grid');
  const osintPlatCount  = document.getElementById('osint-plat-count');
  const osintFindWrap   = document.getElementById('osint-findings-wrap');
  const osintCountBadge = document.getElementById('osint-count-badge');
  const osintExportBtn  = document.getElementById('osint-export-btn');
  const osintFindList   = document.getElementById('osint-findings-list');
  const osintSummary    = document.getElementById('osint-summary-card');

  let osintEvt      = null;
  let osintRunning  = false;
  let osintFindings = [];
  let osintPhase    = 0;
  const TOTAL_PHASES = 5;

  // type badge
  function detectType(q) {
    if (!q) return null;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return 'EMAIL';
    if (/^[\+]?[\d\s\-\(\)]{7,15}$/.test(q))  return 'PHONE';
    if (/\s/.test(q))                             return 'NAME';
    return 'USERNAME';
  }

  osintInput.addEventListener('input', () => {
    const t = detectType(osintInput.value.trim());
    if (t) { osintTypeBadge.textContent = t; osintTypeBadge.classList.remove('hidden'); }
    else   { osintTypeBadge.classList.add('hidden'); }
  });

  function setPhase(phase, name) {
    osintPhase = phase;
    const pct  = Math.round((phase / TOTAL_PHASES) * 100);
    osintPhaseLabel.textContent  = `Phase ${phase}/${TOTAL_PHASES}: ${name}`;
    osintPhaseFill.style.width   = pct + '%';
    osintPhasePct.textContent    = pct + '%';
  }

  // ── Result card builder ──
  function buildBreachCard(d) {
    const b = d.breach;
    const r = d.record;
    const sev = { critical:'sev-critical', high:'sev-high', medium:'sev-medium' }[b.severity] || 'sev-medium';
    const crackedHtml = r.cracked
      ? `<div class="breach-row cracked-row">
           <span class="bkey">🔓 Cracked PW</span>
           <span class="bval cracked-pw">${escHtml(r.cracked)}</span>
           <span class="never-reuse">⚠ NEVER USE AGAIN</span>
         </div>`
      : `<div class="breach-row">
           <span class="bkey">🔒 Status</span>
           <span class="bval dim-val">Hash not in public crack list (${escHtml(r.algo)})</span>
         </div>`;

    const card = document.createElement('div');
    card.className = 'breach-card';
    card.innerHTML = `
      <div class="breach-card-header">
        <span class="breach-name">${escHtml(b.name)}</span>
        <span class="breach-sev ${sev}">${b.severity.toUpperCase()}</span>
        <span class="breach-date">${escHtml(b.date)}</span>
        <span class="breach-records">${escHtml(b.records)} records</span>
      </div>
      <div class="breach-card-body">
        <div class="breach-row"><span class="bkey">📧 Email</span><span class="bval">${escHtml(r.email)}</span></div>
        <div class="breach-row"><span class="bkey">👤 Username</span><span class="bval">${escHtml(r.username)}</span></div>
        <div class="breach-row"><span class="bkey">🔑 Hash (${escHtml(r.algo)})</span><span class="bval hash-val">${escHtml(r.hash)}</span></div>
        ${crackedHtml}
        ${r.dob ? `<div class="breach-row"><span class="bkey">📅 DOB</span><span class="bval">${escHtml(r.dob)}</span></div>` : ''}
        ${r.ip  ? `<div class="breach-row"><span class="bkey">🌐 IP</span><span class="bval">${escHtml(r.ip)}</span></div>` : ''}
        ${r.phone ? `<div class="breach-row"><span class="bkey">📱 Phone</span><span class="bval">${escHtml(r.phone)}</span></div>` : ''}
        <div class="breach-row"><span class="bkey">📂 Exposed</span><span class="bval exposed-tags">${(b.types||[]).map(t=>`<span class="ori-tag">${escHtml(t)}</span>`).join('')}</span></div>
      </div>`;
    return card;
  }

  function buildPasteCard(d) {
    const card = document.createElement('div');
    card.className = 'paste-card';
    card.innerHTML = `
      <div class="breach-card-header">
        <span class="breach-name">📋 ${escHtml(d.site)}</span>
        <span class="breach-sev sev-medium">PASTE</span>
        <span class="breach-records">${escHtml(String(d.lines))} lines</span>
      </div>
      <div class="breach-card-body">
        <div class="breach-row"><span class="bkey">Snippet</span><span class="bval hash-val">${escHtml(d.snippet)}</span></div>
      </div>`;
    return card;
  }

  // ── Platform grid pill ──
  function addPlatformPill(name, found) {
    const pill = document.createElement('span');
    pill.className = 'plat-pill' + (found ? ' plat-hit' : ' plat-miss');
    pill.textContent = name;
    osintPlatGrid.appendChild(pill);
  }

  // ── Main scan ──
  function runOsint() {
    const query = osintInput.value.trim();
    if (!query || osintRunning) return;

    // close previous
    if (osintEvt) { osintEvt.close(); osintEvt = null; }

    osintRunning = true;
    osintFindings = [];

    // reset UI
    osintLive.classList.remove('hidden');
    osintOutput.innerHTML = '';
    osintPlatGrid.innerHTML = '';
    osintPlatWrap.classList.add('hidden');
    osintFindList.innerHTML = '';
    osintFindWrap.classList.add('hidden');
    osintSummary.classList.add('hidden');
    osintSummary.innerHTML = '';
    osintCountBadge.textContent = '';
    osintPlatCount.textContent = '';
    setPhase(0, 'Initializing...');
    osintSrcCount.textContent = '';
    osintConsoleLbl.textContent = 'osint_scan';

    osintBtn.classList.add('hidden');
    osintStopBtn.classList.remove('hidden');

    let platTotal = 0, platHits = 0;
    let breachHits = 0, pasteHits = 0;

    osintEvt = new EventSource(`/fpeds/osint?q=${encodeURIComponent(query)}`);

    osintEvt.onmessage = (e) => {
      const d = JSON.parse(e.data);

      if (d.type === 'start') {
        osintConsoleLbl.textContent = `osint — ${escHtml(d.queryType)}`;
        conLine(osintOutput, `[${ts()}] ${escHtml(d.message)}`, 'c-init');
      }

      if (d.type === 'phase') {
        setPhase(d.phase, d.name);
        conLine(osintOutput, `[${ts()}] ── Phase ${d.phase}: ${escHtml(d.name)} ──`, 'c-category');
      }

      if (d.type === 'dork') {
        if (d.found) {
          conLine(osintOutput, `[${ts()}]  ✓ ${escHtml(d.dork)} → <span style="color:var(--green)">${escHtml(d.snippet)}</span>`, 'c-site-hit');
        } else {
          conLine(osintOutput, `[${ts()}]  · ${escHtml(d.dork)}`, 'c-site-miss');
        }
      }

      if (d.type === 'platform') {
        osintPlatWrap.classList.remove('hidden');
        platTotal++;
        if (d.found) platHits++;
        addPlatformPill(d.platform, d.found);
        osintPlatCount.textContent = `${platHits} / ${platTotal}`;
      }

      if (d.type === 'breach_check') {
        if (d.found) {
          conLine(osintOutput, `[${ts()}]  🔴 BREACH HIT → <span style="color:#ff4444">${escHtml(d.breach)}</span>`, 'c-site-hit');
        } else {
          conLine(osintOutput, `[${ts()}]  · ${escHtml(d.breach)}`, 'c-site-miss');
        }
      }

      if (d.type === 'breach_hit') {
        breachHits++;
        osintFindWrap.classList.remove('hidden');
        osintFindings.push(d);
        const card = buildBreachCard(d);
        osintFindList.appendChild(card);
        osintCountBadge.textContent = `${breachHits} breach${breachHits !== 1 ? 'es' : ''} found`;
      }

      if (d.type === 'paste_hit') {
        pasteHits++;
        osintFindWrap.classList.remove('hidden');
        osintFindings.push({ type:'paste', ...d });
        const card = buildPasteCard(d);
        osintFindList.appendChild(card);
        conLine(osintOutput, `[${ts()}]  📋 PASTE REF → <span style="color:#f59e0b">${escHtml(d.site)}</span>`, 'c-site-hit');
      }

      if (d.type === 'paste_miss') {
        conLine(osintOutput, `[${ts()}]  · ${escHtml(d.site)}`, 'c-site-miss');
      }

      if (d.type === 'summary') {
        const score = d.exposureScore;
        const scoreColor = score >= 70 ? '#ff4444' : score >= 40 ? '#f59e0b' : '#22c55e';
        const scoreLabel = score >= 70 ? 'HIGH EXPOSURE' : score >= 40 ? 'MODERATE' : 'LOW';
        osintSummary.classList.remove('hidden');
        osintSummary.innerHTML = `
          <div class="summary-header">
            <span class="summary-title">Scan Complete — Exposure Report</span>
            <span class="summary-score" style="color:${scoreColor}">${score}/100 — ${scoreLabel}</span>
          </div>
          <div class="summary-grid">
            <div class="sum-stat"><span class="sum-num" style="color:#ff4444">${d.breachCount}</span><span class="sum-lbl">Breach DBs</span></div>
            <div class="sum-stat"><span class="sum-num" style="color:#60a5fa">${d.platformCount}</span><span class="sum-lbl">Platforms</span></div>
            <div class="sum-stat"><span class="sum-num" style="color:#f59e0b">${d.pasteCount}</span><span class="sum-lbl">Paste Refs</span></div>
          </div>
          <div class="summary-note">⚠ Change any exposed passwords immediately. Enable 2FA on all accounts. Check <strong>haveibeenpwned.com</strong> for real-time breach verification.</div>`;
        conLine(osintOutput, `[${ts()}] Scan complete. Score: ${score}/100`, 'c-done');
        osintRunning = false;
        osintBtn.classList.remove('hidden');
        osintStopBtn.classList.add('hidden');
      }

      if (d.type === 'error') {
        conLine(osintOutput, `[${ts()}] Error: ${escHtml(d.message)}`, 'c-err');
        stopOsint();
      }
    };

    osintEvt.onerror = () => {
      if (osintRunning) {
        conLine(osintOutput, `[${ts()}] Stream closed.`, 'c-err');
        stopOsint();
      }
    };
  }

  function stopOsint() {
    osintRunning = false;
    if (osintEvt) { osintEvt.close(); osintEvt = null; }
    osintBtn.classList.remove('hidden');
    osintStopBtn.classList.add('hidden');
  }

  osintBtn.addEventListener('click', runOsint);
  osintStopBtn.addEventListener('click', () => {
    stopOsint();
    conLine(osintOutput, `[${ts()}] Scan stopped by user.`, 'c-err');
  });
  osintInput.addEventListener('keydown', e => { if (e.key === 'Enter') runOsint(); });

  osintExportBtn.addEventListener('click', () => {
    if (!osintFindings.length) return;
    const q = osintInput.value.trim();
    const lines = osintFindings.map(f => {
      if (f.type === 'breach_hit') {
        const b = f.breach, r = f.record;
        return [
          `[BREACH] ${b.name} | ${b.date} | ${b.records} records | Severity: ${b.severity}`,
          `  Email:    ${r.email}`,
          `  Username: ${r.username}`,
          `  Hash:     ${r.hash} (${r.algo})`,
          r.cracked ? `  Cracked:  ${r.cracked}  ← NEVER USE THIS PASSWORD` : '  Cracked:  [not in public crack list]',
          r.dob   ? `  DOB:      ${r.dob}` : '',
          r.ip    ? `  IP:       ${r.ip}` : '',
          r.phone ? `  Phone:    ${r.phone}` : '',
          `  Exposed:  ${(b.types||[]).join(', ')}`,
        ].filter(Boolean).join('\n');
      }
      if (f.type === 'paste') return `[PASTE] ${f.site} | ${f.lines} lines\n  Snippet: ${f.snippet}`;
      return '';
    }).filter(Boolean).join('\n\n');
    const header = `FPEDS OSINT Report\nQuery: ${q}\nGenerated: ${new Date().toISOString()}\n${'-'.repeat(60)}\n\n`;
    const blob = new Blob([header + lines], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `fpeds_osint_${q.replace(/[^a-z0-9]/gi,'_').slice(0,30)}.txt`
    });
    a.click(); URL.revokeObjectURL(a.href);
  });

})();
