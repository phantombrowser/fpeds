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
  const osintInput        = document.getElementById('osint-input');
  const osintTypeBadge    = document.getElementById('osint-type-badge');
  const osintBtn          = document.getElementById('osint-btn');
  const osintConsole      = document.getElementById('osint-console');
  const osintOutput       = document.getElementById('osint-output');
  const osintConsoleLabel = document.getElementById('osint-console-label');
  const osintProgress     = document.getElementById('osint-progress');
  const osintResultsSec   = document.getElementById('osint-results-section');
  const osintResultsList  = document.getElementById('osint-results-list');
  const osintCountBadge   = document.getElementById('osint-count-badge');
  const osintCopyBtn      = document.getElementById('osint-copy-btn');
  const osintExportBtn    = document.getElementById('osint-export-btn');

  let osintEvt     = null;
  let osintRunning = false;
  let osintFindings= [];
  let osintChecked = 0;
  let osintTotal   = 0;

  function detectType(q) {
    if (!q) return null;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return 'EMAIL';
    if (/^[\+]?[\d\s\-\(\)]{7,15}$/.test(q))  return 'PHONE';
    if (/\s/.test(q))                           return 'NAME';
    return 'USERNAME';
  }

  osintInput.addEventListener('input', () => {
    const t = detectType(osintInput.value.trim());
    if (t) {
      osintTypeBadge.textContent = t;
      osintTypeBadge.classList.remove('hidden');
      osintInput.style.paddingRight = '80px';
    } else {
      osintTypeBadge.classList.add('hidden');
      osintInput.style.paddingRight = '';
    }
  });

  function catClass(category) {
    if (category.includes('Breach'))  return 'cat-breach';
    if (category.includes('Social'))  return 'cat-social';
    if (category.includes('Paste'))   return 'cat-paste';
    if (category.includes('People'))  return 'cat-people';
    if (category.includes('Phone'))   return 'cat-phone';
    if (category.includes('Email'))   return 'cat-email';
    if (category.includes('Domain'))  return 'cat-domain';
    return 'cat-default';
  }

  function buildResultCard(d) {
    const item = document.createElement('div');
    item.className = 'osint-result-item';
    const cc = catClass(d.category);
    const det = d.detail || {};

    let bodyHtml = '';

    if (det.type === 'breach') {
      bodyHtml = `
        <div class="ori-field"><span class="ori-key">Breach</span><span class="ori-val highlight">${escHtml(det.breachName)}</span></div>
        <div class="ori-field"><span class="ori-key">Date</span><span class="ori-val">${escHtml(det.date)}</span></div>
        <div class="ori-field"><span class="ori-key">Records</span><span class="ori-val">${escHtml(det.records)}</span></div>
        <div class="ori-field"><span class="ori-key">Data exposed</span><span class="ori-val">
          <div class="ori-exposed">${(det.exposedData||[]).map(t=>`<span class="ori-tag">${escHtml(t)}</span>`).join('')}</div>
        </span></div>`;
    } else if (det.type === 'profile') {
      bodyHtml = `
        <div class="ori-field"><span class="ori-key">Platform</span><span class="ori-val">${escHtml(det.platform)}</span></div>
        <div class="ori-field"><span class="ori-key">Profile</span><span class="ori-val green-val">Found</span></div>
        <div class="ori-field"><span class="ori-key">Visible data</span><span class="ori-val">
          <div class="ori-exposed">${(det.dataVisible||[]).map(t=>`<span class="ori-tag">${escHtml(t)}</span>`).join('')}</div>
        </span></div>`;
    } else if (det.type === 'paste') {
      bodyHtml = `
        <div class="ori-field"><span class="ori-key">Site</span><span class="ori-val">${escHtml(det.site)}</span></div>
        <div class="ori-field"><span class="ori-key">Snippet</span><span class="ori-val red-val">${escHtml(det.snippet)}</span></div>
        <div class="ori-field"><span class="ori-key">Date</span><span class="ori-val">${escHtml(det.pasteDate)}</span></div>`;
    } else if (det.type === 'phone') {
      bodyHtml = `
        <div class="ori-field"><span class="ori-key">Carrier</span><span class="ori-val">${escHtml(det.carrier)}</span></div>
        <div class="ori-field"><span class="ori-key">Region</span><span class="ori-val">${escHtml(det.region)}</span></div>`;
    } else if (det.type === 'email_rep') {
      bodyHtml = `
        <div class="ori-field"><span class="ori-key">Risk score</span><span class="ori-val highlight">${det.riskScore}/100</span></div>
        <div class="ori-field"><span class="ori-key">Disposable</span><span class="ori-val">${det.disposable ? 'Yes' : 'No'}</span></div>`;
    } else {
      bodyHtml = (det.dataFound||[]).map(f=>`<span class="ori-tag">${escHtml(f)}</span>`).join(' ');
      if (bodyHtml) bodyHtml = `<div class="ori-exposed">${bodyHtml}</div>`;
    }

    const note = det.note ? `<div class="ori-note">${escHtml(det.note)}</div>` : '';

    item.innerHTML = `
      <div class="ori-header">
        <span class="ori-cat-tag ${cc}">${escHtml(d.category)}</span>
        <span class="ori-site">${escHtml(d.site)}</span>
      </div>
      <div class="ori-body">${bodyHtml}${note}</div>`;
    return item;
  }

  function runOsint() {
    const query = osintInput.value.trim();
    if (!query || osintRunning) return;

    if (osintEvt) { osintEvt.close(); osintEvt = null; }

    osintRunning  = true;
    osintFindings = [];
    osintChecked  = 0;
    osintTotal    = 0;
    osintResultsList.innerHTML = '';
    osintResultsSec.classList.add('hidden');
    osintConsole.classList.remove('hidden');
    osintOutput.innerHTML = '';
    osintCountBadge.textContent = '';

    osintBtn.disabled = true;
    osintBtn.textContent = 'Scanning…';

    osintEvt = new EventSource(`/fpeds/osint?q=${encodeURIComponent(query)}`);

    osintEvt.onmessage = (e) => {
      const d = JSON.parse(e.data);

      if (d.type === 'start') {
        osintTotal = d.total || 0;
        osintConsoleLabel.textContent = `osint — ${escHtml(d.queryType || 'query')}`;
        conLine(osintOutput, `[${ts()}] ${escHtml(d.message)}`, 'c-init');
      }

      if (d.type === 'category') {
        conLine(osintOutput, `[${ts()}] ${escHtml(d.message)}`, 'c-category');
      }

      if (d.type === 'site_check') {
        osintChecked++;
        osintProgress.textContent = `${osintChecked}/${osintTotal}`;
        if (d.found) {
          conLine(osintOutput, `[${ts()}]  ✓ <span style="color:var(--green)">${escHtml(d.site)}</span>`, 'c-site-hit');
        } else {
          conLine(osintOutput, `[${ts()}]  · ${escHtml(d.site)}`, 'c-site-miss');
        }
      }

      if (d.type === 'result') {
        osintFindings.push(d);
        osintResultsSec.classList.remove('hidden');
        osintCountBadge.textContent = `${osintFindings.length} finding${osintFindings.length !== 1 ? 's' : ''}`;
        const card = buildResultCard(d);
        osintResultsList.appendChild(card);
      }

      if (d.type === 'done') {
        conLine(osintOutput, `[${ts()}] ─────────────────────────────────────────`, 'c-dim');
        conLine(osintOutput, `[${ts()}] ${escHtml(d.message)}`, 'c-done');
        osintBtn.disabled = false;
        osintBtn.textContent = 'Search';
        osintRunning = false;
      }

      if (d.type === 'error') {
        conLine(osintOutput, `[${ts()}] Error: ${escHtml(d.message)}`, 'c-err');
        osintBtn.disabled = false;
        osintBtn.textContent = 'Search';
        osintRunning = false;
      }
    };

    osintEvt.onerror = () => {
      if (osintRunning) {
        osintRunning = false;
        osintBtn.disabled = false;
        osintBtn.textContent = 'Search';
        conLine(osintOutput, `[${ts()}] Connection error.`, 'c-err');
      }
    };
  }

  osintBtn.addEventListener('click', runOsint);
  osintInput.addEventListener('keydown', e => { if (e.key === 'Enter') runOsint(); });

  osintCopyBtn.addEventListener('click', () => {
    if (!osintFindings.length) return;
    const lines = osintFindings.map(f => {
      const d = f.detail || {};
      const base = `[${f.category}] ${f.site}`;
      if (d.type === 'breach') return `${base} — Breach: ${d.breachName} (${d.date}) — Exposed: ${(d.exposedData||[]).join(', ')}`;
      if (d.type === 'profile') return `${base} — Profile found — Data: ${(d.dataVisible||[]).join(', ')}`;
      if (d.type === 'paste') return `${base} — Paste reference found`;
      if (d.type === 'phone') return `${base} — Carrier: ${d.carrier}, Region: ${d.region}`;
      if (d.type === 'email_rep') return `${base} — Risk score: ${d.riskScore}/100`;
      return `${base} — ${(d.dataFound||[]).join(', ')}`;
    }).join('\n');
    navigator.clipboard.writeText(lines).then(() => {
      osintCopyBtn.textContent = 'Copied!';
      setTimeout(() => { osintCopyBtn.textContent = 'Copy Report'; }, 1500);
    }).catch(() => {});
  });

  osintExportBtn.addEventListener('click', () => {
    if (!osintFindings.length) return;
    const q = osintInput.value.trim();
    const header = `OSINT Report — Query: ${q}\nGenerated: ${new Date().toISOString()}\n${'─'.repeat(60)}\n\n`;
    const lines = osintFindings.map(f => {
      const d = f.detail || {};
      let line = `[${f.category}] ${f.site}\n`;
      if (d.type === 'breach')   line += `  Breach: ${d.breachName} | Date: ${d.date} | Records: ${d.records}\n  Exposed: ${(d.exposedData||[]).join(', ')}\n`;
      if (d.type === 'profile')  line += `  Profile found | Data: ${(d.dataVisible||[]).join(', ')}\n`;
      if (d.type === 'paste')    line += `  Paste reference: ${d.site} (${d.pasteDate})\n`;
      if (d.type === 'phone')    line += `  Carrier: ${d.carrier} | Region: ${d.region}\n`;
      if (d.type === 'email_rep')line += `  Risk: ${d.riskScore}/100 | Disposable: ${d.disposable}\n`;
      if (d.note) line += `  Note: ${d.note}\n`;
      return line;
    }).join('\n');
    const blob = new Blob([header + lines], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `fpeds_osint_${q.replace(/[^a-z0-9]/gi,'_').slice(0,30)}.txt`
    });
    a.click(); URL.revokeObjectURL(a.href);
  });

})();
