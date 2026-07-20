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
        if (passNum > 1) conLine(consoleOutput, `[${ts()}] ── Pass ${passNum} ─────────────────────────────────────`, 'c-dim');
      }
      if (d.type === 'query') {
        queryCount++;
        statQueries.textContent = `${queryCount}/${totalQ}`;
        const tag = d.isDork ? `<span style="color:#7c3aed;margin-right:4px">[DORK]</span>` : '';
        conLine(consoleOutput, `[${ts()}] ${tag}${escHtml(d.message)}`, d.isDork ? 'c-category' : 'c-query');
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
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(q))    return 'IP';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return 'EMAIL';
    if (/^[\+]?[\d\s\-\(\)]{7,15}$/.test(q))  return 'PHONE';
    if (/\s/.test(q))                           return 'NAME';
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

  // ── Result card builder — uses DOM methods to guarantee visible text ──
  function row(key, val, extra) {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:5px 0;border-bottom:1px solid #222;color:#e0e0e0;font-size:12px;font-family:Courier New,monospace';
    const k = document.createElement('span');
    k.style.cssText = 'color:#888;min-width:130px;flex-shrink:0;font-size:11px';
    k.textContent = key;
    const v = document.createElement('span');
    v.style.cssText = 'color:#e0e0e0;word-break:break-all;flex:1' + (extra||'');
    v.textContent = val;
    d.appendChild(k); d.appendChild(v);
    return d;
  }

  function buildBreachCard(d) {
    const b = d.breach;
    const r = d.record;
    const sevCls = { critical:'sev-critical', high:'sev-high', medium:'sev-medium' }[b.severity] || 'sev-medium';
    const card = document.createElement('div');
    card.className = 'breach-card';

    // ── Header uses CSS classes ──
    const hdr = document.createElement('div');
    hdr.className = 'breach-card-header';
    const nm = document.createElement('span'); nm.className = 'breach-name'; nm.textContent = b.name;
    const sv = document.createElement('span'); sv.className = 'breach-sev ' + sevCls; sv.textContent = b.severity.toUpperCase();
    const dt = document.createElement('span'); dt.className = 'breach-date'; dt.textContent = b.date;
    const rc = document.createElement('span'); rc.className = 'breach-records'; rc.textContent = b.records + ' records';
    hdr.append(nm, sv, dt, rc);

    // ── Body uses CSS classes ──
    const body = document.createElement('div');
    body.className = 'breach-card-body';

    function brow(k, v, cls) {
      const d2 = document.createElement('div'); d2.className = 'breach-row';
      const ks = document.createElement('span'); ks.className = 'bkey'; ks.textContent = k;
      const vs = document.createElement('span'); vs.className = 'bval' + (cls ? ' ' + cls : ''); vs.textContent = v;
      d2.append(ks, vs); return d2;
    }

    body.appendChild(brow('EMAIL',    r.email));
    body.appendChild(brow('USERNAME', r.username));
    body.appendChild(brow('HASH (' + r.algo + ')', r.hash, 'hash-val'));

    if (r.cracked) {
      const cr = document.createElement('div'); cr.className = 'breach-row cracked-row';
      const ck = document.createElement('span'); ck.className = 'bkey'; ck.textContent = 'CRACKED PASSWORD';
      const cv = document.createElement('span'); cv.className = 'bval cracked-pw'; cv.textContent = r.cracked;
      const wn = document.createElement('span'); wn.className = 'never-reuse'; wn.textContent = 'NEVER USE AGAIN';
      cr.append(ck, cv, wn); body.appendChild(cr);
    } else {
      body.appendChild(brow('HASH STATUS', 'Not in public crack list (' + r.algo + ')', 'dim-val'));
    }

    if (r.dob)   body.appendChild(brow('DATE OF BIRTH', r.dob));
    if (r.ip)    body.appendChild(brow('IP ADDRESS',    r.ip));
    if (r.phone) body.appendChild(brow('PHONE',         r.phone));

    const expRow = document.createElement('div'); expRow.className = 'breach-row';
    const expK   = document.createElement('span'); expK.className = 'bkey'; expK.textContent = 'EXPOSED DATA';
    const expV   = document.createElement('div');  expV.className  = 'exposed-tags';
    (b.types||[]).forEach(t => {
      const tag = document.createElement('span'); tag.className = 'ori-tag'; tag.textContent = t; expV.appendChild(tag);
    });
    expRow.append(expK, expV); body.appendChild(expRow);

    card.append(hdr, body);
    return card;
  }

  function buildIPCard(d) {
    const card = document.createElement('div'); card.className = 'breach-card ip-card';
    const hdr  = document.createElement('div'); hdr.className  = 'breach-card-header';
    const nm   = document.createElement('span'); nm.className  = 'breach-name'; nm.style.color = '#60a5fa'; nm.textContent = 'IP INTEL: ' + d.ip;
    const st   = document.createElement('span');
    if (d.listed) { st.className = 'breach-sev sev-critical'; st.textContent = 'BLACKLISTED'; }
    else          { st.className = 'breach-sev'; st.style.cssText = 'background:#0a2010;border:1px solid #1a5030;color:#4ade80'; st.textContent = 'CLEAN'; }
    hdr.append(nm, st);
    const body = document.createElement('div'); body.className = 'breach-card-body';
    function brow2(k, v, cls) {
      const d2 = document.createElement('div'); d2.className = 'breach-row';
      const ks = document.createElement('span'); ks.className = 'bkey'; ks.textContent = k;
      const vs = document.createElement('span'); vs.className = 'bval' + (cls ? ' ' + cls : ''); vs.textContent = v;
      d2.append(ks, vs); return d2;
    }
    body.appendChild(brow2('GEOLOCATION', d.geo));
    body.appendChild(brow2('ISP / ASN',   d.isp));
    body.appendChild(brow2('ABUSE SCORE', d.abuseScore + '/100', d.abuseScore > 50 ? 'red-val' : 'green-val'));
    body.appendChild(brow2('OPEN PORTS',  d.openPorts));
    if (d.blacklists && d.blacklists.length) body.appendChild(brow2('BLACKLISTS', d.blacklists.join(', '), 'highlight'));
    card.append(hdr, body); return card;
  }

  function buildPasteCard(d) {
    const card   = document.createElement('div'); card.className  = 'breach-card paste-card';
    const hdr    = document.createElement('div'); hdr.className   = 'breach-card-header';
    const nm     = document.createElement('span'); nm.className   = 'breach-name'; nm.style.color = '#f59e0b'; nm.textContent = 'PASTE: ' + d.site;
    const rc     = document.createElement('span'); rc.className   = 'breach-records'; rc.textContent = d.lines + ' lines';
    hdr.append(nm, rc);
    const body   = document.createElement('div'); body.className  = 'breach-card-body';
    const snipR  = document.createElement('div'); snipR.className = 'breach-row';
    const snipK  = document.createElement('span'); snipK.className = 'bkey'; snipK.textContent = 'SNIPPET';
    const snipV  = document.createElement('span'); snipV.className = 'bval'; snipV.style.color = '#60a5fa'; snipV.textContent = d.snippet;
    snipR.append(snipK, snipV); body.appendChild(snipR);
    card.append(hdr, body); return card;
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

      if (d.type === 'ip_info') {
        osintFindWrap.classList.remove('hidden');
        osintFindings.push({ type:'ip_info', ...d });
        const card = buildIPCard(d);
        osintFindList.appendChild(card);
        conLine(osintOutput, `[${ts()}]  🌐 IP INTEL → <span style="color:#60a5fa">${escHtml(d.ip)}</span> | ${escHtml(d.geo)} | Abuse: ${d.abuseScore}/100`, 'c-site-hit');
        osintCountBadge.textContent = `${osintFindings.length} finding${osintFindings.length !== 1 ? 's' : ''}`;
      }

      if (d.type === 'ip_source') {
        if (d.flagged) {
          conLine(osintOutput, `[${ts()}]  🔴 ${escHtml(d.source)} → <span style="color:#ff4444">${escHtml(d.detail)}</span>`, 'c-site-hit');
        } else {
          conLine(osintOutput, `[${ts()}]  · ${escHtml(d.source)} — clean`, 'c-site-miss');
        }
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

  /* ══════════════════════════════════════════
     LOG | CREATION TAB
  ══════════════════════════════════════════ */
  const loggerAgreement  = document.getElementById('logger-agreement');
  const loggerMain       = document.getElementById('logger-main');
  const agreeAcceptBtn   = document.getElementById('agree-accept-btn');
  const agreeDeclineBtn  = document.getElementById('agree-decline-btn');
  const loggerDropZone   = document.getElementById('logger-drop-zone');
  const loggerFileInput  = document.getElementById('logger-file-input');
  const loggerPreviewWrap= document.getElementById('logger-preview-wrap');
  const loggerPreviewImg = document.getElementById('logger-preview-img');
  const loggerPreviewName= document.getElementById('logger-preview-name');
  const loggerNameInput  = document.getElementById('logger-name');
  const loggerCreateBtn  = document.getElementById('logger-create-btn');
  const loggerCreateStat = document.getElementById('logger-create-status');
  const loggerResult     = document.getElementById('logger-result');
  const loggerUrlOut     = document.getElementById('logger-url-out');
  const loggerCopyUrl    = document.getElementById('logger-copy-url');
  const loggerListSec    = document.getElementById('logger-list-section');
  const loggerList       = document.getElementById('logger-list');
  const loggerRefreshBtn = document.getElementById('logger-refresh-btn');

  let loggerFile    = null;
  let loggerAgreed  = false;

  // Show agreement when logger tab is activated
  document.querySelector('[data-tab="logger"]').addEventListener('click', () => {
    if (!loggerAgreed) {
      loggerAgreement.classList.remove('hidden');
      loggerMain.classList.add('hidden');
    } else {
      loadLoggerList();
    }
  });

  agreeAcceptBtn.addEventListener('click', () => {
    loggerAgreed = true;
    loggerAgreement.classList.add('hidden');
    loggerMain.classList.remove('hidden');
    loadLoggerList();
  });

  agreeDeclineBtn.addEventListener('click', () => {
    loggerAgreement.classList.add('hidden');
    document.querySelector('[data-tab="check"]').click();
  });

  // Drop zone
  loggerDropZone.addEventListener('click', () => loggerFileInput.click());
  loggerDropZone.addEventListener('dragover', e => { e.preventDefault(); loggerDropZone.classList.add('drop-zone-hover'); });
  loggerDropZone.addEventListener('dragleave', () => loggerDropZone.classList.remove('drop-zone-hover'));
  loggerDropZone.addEventListener('drop', e => {
    e.preventDefault();
    loggerDropZone.classList.remove('drop-zone-hover');
    const file = e.dataTransfer.files[0];
    if (file) setLoggerFile(file);
  });
  loggerFileInput.addEventListener('change', () => {
    if (loggerFileInput.files[0]) setLoggerFile(loggerFileInput.files[0]);
  });

  function setLoggerFile(file) {
    loggerFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      loggerPreviewImg.src = ev.target.result;
      loggerPreviewName.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
      loggerPreviewWrap.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
    loggerCreateBtn.disabled = false;
    loggerCreateBtn.textContent = 'Generate Logger Link';
    loggerCreateStat.textContent = '';
  }

  // Create logger
  loggerCreateBtn.addEventListener('click', async () => {
    if (!loggerFile) return;
    loggerCreateBtn.disabled = true;
    loggerCreateBtn.textContent = 'Uploading…';
    loggerCreateStat.textContent = '';

    const form = new FormData();
    form.append('image', loggerFile);
    form.append('name', loggerNameInput.value.trim() || 'Logger ' + Date.now());

    try {
      const r = await fetch('/fpeds/logger/create', { method: 'POST', body: form });
      const data = await r.json();
      if (data.ok) {
        const fullUrl = window.location.origin + data.url;
        loggerUrlOut.value = fullUrl;
        loggerResult.classList.remove('hidden');
        loggerCreateStat.textContent = '✓ Logger created!';
        loggerCreateStat.style.color = 'var(--green)';
        loadLoggerList();
      } else {
        loggerCreateStat.textContent = data.error || 'Upload failed.';
        loggerCreateStat.style.color = 'var(--red)';
      }
    } catch {
      loggerCreateStat.textContent = 'Network error.';
      loggerCreateStat.style.color = 'var(--red)';
    }
    loggerCreateBtn.disabled = false;
    loggerCreateBtn.textContent = 'Generate Logger Link';
  });

  loggerCopyUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(loggerUrlOut.value).then(() => {
      loggerCopyUrl.textContent = 'Copied!';
      setTimeout(() => { loggerCopyUrl.textContent = 'Copy'; }, 1500);
    }).catch(() => {});
  });

  async function loadLoggerList() {
    try {
      const r = await fetch('/fpeds/logger/list');
      const data = await r.json();
      const entries = Object.values(data);
      if (entries.length === 0) { loggerListSec.classList.add('hidden'); return; }
      loggerListSec.classList.remove('hidden');
      loggerList.innerHTML = '';
      entries.reverse().forEach(lg => {
        const url = window.location.origin + '/fpeds/l/' + lg.id;
        const item = document.createElement('div');
        item.className = 'logger-item';
        item.innerHTML = `
          <div class="li-info">
            <span class="li-name">${escHtml(lg.name)}</span>
            <span class="li-meta">${new Date(lg.createdAt).toLocaleDateString()} · by ${escHtml(lg.createdBy)}</span>
          </div>
          <span class="li-url">${escHtml(url)}</span>
          <div class="li-actions">
            <button class="link-action-btn li-copy" data-url="${escHtml(url)}">Copy URL</button>
            <button class="link-action-btn li-open" data-url="${escHtml(url)}">Open</button>
            <button class="link-action-btn li-del btn-del" data-id="${escHtml(lg.id)}">Delete</button>
          </div>`;
        item.querySelector('.li-copy').addEventListener('click', e => {
          navigator.clipboard.writeText(e.target.dataset.url).then(() => { e.target.textContent = 'Copied!'; setTimeout(() => { e.target.textContent = 'Copy URL'; }, 1500); });
        });
        item.querySelector('.li-open').addEventListener('click', e => window.open(e.target.dataset.url, '_blank', 'noopener'));
        item.querySelector('.li-del').addEventListener('click', async e => {
          if (!confirm('Delete this logger?')) return;
          await fetch('/fpeds/logger/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.target.dataset.id }) });
          loadLoggerList();
        });
        loggerList.appendChild(item);
      });
    } catch {}
  }

  loggerRefreshBtn.addEventListener('click', loadLoggerList);

  /* ══════════════════════════════════════════
     LOGS TAB
  ══════════════════════════════════════════ */
  const webhookInput   = document.getElementById('webhook-url-input');
  const webhookSaveBtn = document.getElementById('webhook-save-btn');
  const webhookTestBtn = document.getElementById('webhook-test-btn');
  const webhookStatus  = document.getElementById('webhook-status');
  const logsRefreshBtn = document.getElementById('logs-refresh-btn');
  const logsExportBtn  = document.getElementById('logs-export-btn');
  const logsClearBtn   = document.getElementById('logs-clear-btn');
  const logsList       = document.getElementById('logs-list');
  const logsCountBadge = document.getElementById('logs-count-badge');
  let cachedLogs = [];

  // Load webhook config when logs tab opens
  document.querySelector('[data-tab="logs"]').addEventListener('click', () => {
    loadLogsConfig(); loadLogs_();
  });

  async function loadLogsConfig() {
    try {
      const r = await fetch('/fpeds/config');
      const data = await r.json();
      if (data.webhookUrl) webhookInput.value = data.webhookUrl;
    } catch {}
  }

  webhookSaveBtn.addEventListener('click', async () => {
    try {
      const r = await fetch('/fpeds/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhookUrl: webhookInput.value.trim() }) });
      const data = await r.json();
      webhookStatus.textContent = data.ok ? '✓ Saved' : 'Error saving';
      webhookStatus.style.color = data.ok ? 'var(--green)' : 'var(--red)';
      setTimeout(() => { webhookStatus.textContent = ''; }, 2000);
    } catch { webhookStatus.textContent = 'Network error'; webhookStatus.style.color = 'var(--red)'; }
  });

  webhookTestBtn.addEventListener('click', async () => {
    const url = webhookInput.value.trim();
    if (!url) { webhookStatus.textContent = 'Enter a webhook URL first.'; webhookStatus.style.color = 'var(--red)'; return; }
    webhookStatus.textContent = 'Sending test…';
    webhookStatus.style.color = 'var(--text-dim)';
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [{ title: 'NEW | HIT', description: '/fpeds | credits @vet\n\nThis is a test embed from /fpeds.', color: 5763719, footer: { text: '/fpeds · Test' } }] }) });
      webhookStatus.textContent = '✓ Test sent';
      webhookStatus.style.color = 'var(--green)';
    } catch { webhookStatus.textContent = 'Failed to reach webhook'; webhookStatus.style.color = 'var(--red)'; }
    setTimeout(() => { webhookStatus.textContent = ''; }, 3000);
  });

  async function loadLogs_() {
    try {
      const r = await fetch('/fpeds/logs/list');
      cachedLogs = await r.json();
      renderLogs();
    } catch {}
  }

  function renderLogs() {
    logsCountBadge.textContent = cachedLogs.length;
    if (cachedLogs.length === 0) {
      logsList.innerHTML = '<div class="logs-empty">No logs yet — create a logger, share the link, and IPs will appear here.</div>';
      return;
    }
    logsList.innerHTML = '';
    cachedLogs.forEach(log => {
      const item = document.createElement('div');
      item.className = 'log-entry' + (log.isVpn ? ' log-vpn' : '');
      const dt = new Date(log.timestamp);
      const timeStr = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString();
      item.innerHTML = `
        <div class="le-top">
          <span class="le-ip">${escHtml(log.ip)}</span>
          <span class="le-badge ${log.isVpn ? 'le-vpn' : 'le-clean'}">${log.isVpn ? 'VPN' : 'CLEAN'}</span>
          <span class="le-logger">${escHtml(log.loggerName)}</span>
          <span class="le-time">${timeStr}</span>
        </div>
        <div class="le-meta">
          <span>${escHtml(log.country)}</span>
          <span class="le-sep">·</span>
          <span>${escHtml(log.city)}</span>
          <span class="le-sep">·</span>
          <span>${escHtml(log.isp)}</span>
          <span class="le-sep">·</span>
          <span class="le-ua">${escHtml(log.userAgent)}</span>
        </div>`;
      logsList.appendChild(item);
    });
  }

  logsRefreshBtn.addEventListener('click', loadLogs_);

  logsClearBtn.addEventListener('click', async () => {
    if (!confirm('Clear all logs? This cannot be undone.')) return;
    await fetch('/fpeds/logs/clear', { method: 'POST' });
    cachedLogs = [];
    renderLogs();
  });

  logsExportBtn.addEventListener('click', () => {
    if (!cachedLogs.length) return;
    const lines = cachedLogs.map(l =>
      `[${l.timestamp}] ${l.ip} | ${l.isVpn ? 'VPN' : 'CLEAN'} | ${l.country}, ${l.city} | ${l.isp} | Logger: ${l.loggerName}\n  UA: ${l.userAgent}`
    ).join('\n');
    const blob = new Blob(['/fpeds LOGS\n' + '='.repeat(60) + '\n\n' + lines], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'fpeds_logs.txt' });
    a.click(); URL.revokeObjectURL(a.href);
  });

  /* ══════════════════════════════════════════
     GLOBAL | CHAT TAB
  ══════════════════════════════════════════ */
  const chatRulesModal  = document.getElementById('chat-rules-modal');
  const chatRulesAccept = document.getElementById('chat-rules-accept');
  const chatMainEl      = document.getElementById('chat-main');
  const chatMessages    = document.getElementById('chat-messages');
  const chatInput       = document.getElementById('chat-input');
  const chatSendBtn     = document.getElementById('chat-send-btn');
  const chatCharLeft    = document.getElementById('chat-char-left');
  const chatOnlineCount = document.getElementById('chat-online-count');

  let chatEvt      = null;
  let chatAccepted = false;
  let myUsername   = '';

  // Get username
  fetch('/fpeds/me').then(r => r.json()).then(d => { if (d.username) myUsername = d.username; }).catch(() => {});

  document.querySelector('[data-tab="chat"]').addEventListener('click', () => {
    if (!chatAccepted) {
      chatRulesModal.classList.remove('hidden');
      chatMainEl.classList.add('hidden');
    }
  });

  chatRulesAccept.addEventListener('click', () => {
    chatAccepted = true;
    chatRulesModal.classList.add('hidden');
    chatMainEl.classList.remove('hidden');
    connectChat();
  });

  function connectChat() {
    if (chatEvt) return;
    chatEvt = new EventSource('/fpeds/chat/stream');
    chatEvt.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'history') {
        chatMessages.innerHTML = '';
        if (d.messages.length === 0) {
          appendSystemMsg('No messages yet. Be the first!');
        } else {
          d.messages.forEach(m => appendChatMsg(m));
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
      if (d.type === 'message') {
        appendChatMsg(d);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
      if (d.type === 'count') {
        chatOnlineCount.textContent = d.count + ' online';
      }
    };
    chatEvt.onerror = () => {
      appendSystemMsg('Connection lost. Reconnecting…');
    };
  }

  function appendChatMsg(msg) {
    const div = document.createElement('div');
    const isMe = msg.username === myUsername;
    div.className = 'chat-msg' + (isMe ? ' chat-msg-me' : '');
    const dt = new Date(msg.timestamp);
    const t  = dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0');
    div.innerHTML = `<span class="msg-user${isMe ? ' msg-user-me' : ''}">${escHtml(msg.username)}</span><span class="msg-time">${t}</span><span class="msg-text">${escHtml(msg.message)}</span>`;
    chatMessages.appendChild(div);
  }

  function appendSystemMsg(text) {
    const div = document.createElement('div');
    div.className = 'chat-system-msg';
    div.textContent = text;
    chatMessages.appendChild(div);
  }

  chatInput.addEventListener('input', () => {
    const left = 500 - chatInput.value.length;
    chatCharLeft.textContent = left + ' chars left';
    chatCharLeft.style.color = left < 50 ? 'var(--red)' : 'var(--text-dimmer)';
  });

  async function sendChatMessage() {
    const msg = chatInput.value.trim();
    if (!msg) return;
    chatInput.value = '';
    chatCharLeft.textContent = '500 chars left';
    chatSendBtn.disabled = true;
    try {
      await fetch('/fpeds/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
    } catch { appendSystemMsg('Failed to send message.'); }
    chatSendBtn.disabled = false;
    chatInput.focus();
  }

  chatSendBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });

})();
