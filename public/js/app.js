/* ─── fpeds — app.js ─── */
(function () {
  'use strict';

  /* ── Tab switching ── */
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

  /* ── Helpers ── */
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
    return {
      active:          { label: 'ACTIVE',       cls: 'badge-active',   dotCls: 's-active'   },
      inactive:        { label: 'INACTIVE',      cls: 'badge-inactive', dotCls: 's-inactive' },
      dead:            { label: 'DEAD',          cls: 'badge-dead',     dotCls: 's-dead'     },
      tor_unavailable: { label: 'TOR REQ',       cls: 'badge-tor',      dotCls: 's-tor'      },
      error:           { label: 'ERROR',         cls: 'badge-error',    dotCls: 's-dead'     },
    }[status] || { label: 'UNKNOWN', cls: 'badge-error', dotCls: 's-dead' };
  }

  function parseUrls(raw) {
    // Split by whitespace, commas, newlines — dedupe
    const tokens = raw.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    return [...new Set(tokens)].map(u => /^https?:\/\//i.test(u) ? u : 'http://' + u);
  }

  /* ═══════════════════════════════════════════
     CHECK TAB
  ═══════════════════════════════════════════ */
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

  /* Live URL count while typing */
  urlInput.addEventListener('input', () => {
    const urls = parseUrls(urlInput.value);
    checkCountLbl.textContent = urls.length > 0 ? `${urls.length} URL${urls.length > 1 ? 's' : ''}` : '';
  });

  /* ── History ── */
  function saveHistory() {
    localStorage.setItem('fpeds_history', JSON.stringify(checkHistory.slice(0, 60)));
  }

  function renderHistory() {
    if (checkHistory.length === 0) {
      historyList.innerHTML = '<div class="history-empty">No checks yet.</div>';
      return;
    }
    historyList.innerHTML = checkHistory.map((item, i) => {
      const m = statusMeta(item.status);
      const code = item.httpCode ? `<span class="history-code">${item.httpCode}</span>` : '';
      return `<div class="history-item" data-index="${i}">
        <span class="history-status ${m.dotCls.replace('s-', 'hs-')}"></span>
        <span class="history-url" title="${escHtml(item.url)}">${escHtml(item.url)}</span>
        ${code}
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

  /* ── Render a single result row ── */
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
    const codeHtml = data.httpCode
      ? `<span class="cri-code ${httpCodeClass(data.httpCode)}">${data.httpCode}</span>`
      : `<span class="cri-code"></span>`;
    const timeHtml = data.responseTime !== undefined
      ? `<span class="cri-time">${data.responseTime}ms</span>`
      : `<span class="cri-time"></span>`;
    const onionHtml = data.isOnion ? `<span class="cri-onion">.onion</span>` : '';

    item.innerHTML = `
      <span class="cri-status ${m.dotCls}"></span>
      <span class="cri-badge ${m.cls}">${m.label}</span>
      ${codeHtml}
      <span class="cri-url">${onionHtml}<a href="${escHtml(data.url)}" target="_blank" rel="noopener">${escHtml(data.url)}</a></span>
      ${timeHtml}`;
    return item;
  }

  /* ── Update summary bar ── */
  function updateSummary(results) {
    const active   = results.filter(r => r.status === 'active').length;
    const inactive = results.filter(r => r.status === 'inactive').length;
    const dead     = results.filter(r => ['dead','error','tor_unavailable'].includes(r.status)).length;
    resultsSummary.innerHTML = `
      <span class="sum-item"><span class="sum-dot green"></span><span style="color:var(--green)">${active}</span></span>
      <span class="sum-item"><span class="sum-dot yellow"></span><span style="color:var(--yellow)">${inactive}</span></span>
      <span class="sum-item"><span class="sum-dot red"></span><span style="color:var(--red)">${dead}</span></span>`;
  }

  /* ── Main check runner ── */
  async function runCheck() {
    const urls = parseUrls(urlInput.value);
    if (urls.length === 0) return;

    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking…';
    resultsWrap.classList.remove('hidden');
    resultsList.innerHTML = '';
    resultsSummary.innerHTML = '';

    // Render pending rows immediately
    const rowMap = {};
    urls.forEach(url => {
      const row = createResultRow({ url }, true);
      resultsList.appendChild(row);
      rowMap[url] = row;
    });

    // Fire all requests concurrently
    const results = [];
    const promises = urls.map(async (url) => {
      try {
        const resp = await fetch('/fpeds/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await resp.json();
        results.push(data);

        // Replace pending row in place
        const newRow = createResultRow(data);
        rowMap[url].replaceWith(newRow);
        rowMap[url] = newRow;

        updateSummary(results);

        // Add to history
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
    });

    await Promise.allSettled(promises);
    checkBtn.disabled = false;
    checkBtn.textContent = 'Check';
  }

  checkBtn.addEventListener('click', runCheck);

  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runCheck();
  });

  clearResultsBtn.addEventListener('click', () => {
    resultsWrap.classList.add('hidden');
    resultsList.innerHTML = '';
  });

  clearHistBtn.addEventListener('click', () => {
    checkHistory = [];
    saveHistory();
    renderHistory();
  });

  renderHistory();


  /* ═══════════════════════════════════════════
     SEARCH TAB
  ═══════════════════════════════════════════ */
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

  let evtSource    = null;
  let isSearching  = false;
  let foundLinks   = [];
  let queryCount   = 0;
  let totalQueries = 50;
  let passCount    = 1;

  function conLine(text, cls) {
    const span = document.createElement('span');
    span.className = 'console-line ' + (cls || 'c-dim');
    span.innerHTML = text;
    consoleOutput.appendChild(span);
    // Keep max 800 lines for perf
    while (consoleOutput.children.length > 800) {
      consoleOutput.removeChild(consoleOutput.firstChild);
    }
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function clearConsole() {
    consoleOutput.innerHTML = '';
    foundLinksList.innerHTML = '';
    foundLinks = [];
    queryCount = 0;
    passCount  = 1;
    statQueries.textContent = `0/${totalQueries}`;
    statLinks.textContent   = '0';
    statPass.textContent    = '1';
  }

  function ts() {
    const n = new Date();
    return [n.getHours(), n.getMinutes(), n.getSeconds()]
      .map(v => String(v).padStart(2, '0')).join(':');
  }

  function addFoundLink(url, name) {
    // Dedupe
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

    clearConsole();
    searchBtn.disabled = true;
    searchBtnLabel.textContent = 'Scanning…';
    stopBtn.classList.remove('hidden');
    searchStats.classList.remove('hidden');

    const infinity = infinityCheck.checked;
    const url = '/fpeds/search?fast=1' + (infinity ? '&infinity=1' : '');

    conLine(`[${ts()}] Initializing scan engine${infinity ? ' — ∞ INFINITY MODE' : ''}...`, 'c-init');

    evtSource = new EventSource(url);

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.type === 'start') {
        totalQueries = data.total || 50;
        conLine(`[${ts()}] ${escHtml(data.message)}`, 'c-init');
      }

      if (data.type === 'pass') {
        passCount = data.pass;
        statPass.textContent = passCount;
        queryCount = 0;
        conLine(`[${ts()}] ── Pass ${passCount} ──────────────────────────`, 'c-dim');
      }

      if (data.type === 'query') {
        queryCount++;
        statQueries.textContent = `${queryCount}/${totalQueries}`;
        conLine(`[${ts()}] ${escHtml(data.message)}`, 'c-query');
      }

      if (data.type === 'link') {
        conLine(`[${ts()}]  ↳ <span style="color:var(--green)">${escHtml(data.url)}</span>  <span class="c-dim">${escHtml(data.name)}</span>`, 'c-link');
        addFoundLink(data.url, data.name);
      }

      if (data.type === 'done') {
        conLine(`[${ts()}] ─────────────────────────────────────────`, 'c-dim');
        conLine(`[${ts()}] ${escHtml(data.message)}`, 'c-done');
        if (!infinity) stopSearch(true);
      }
    };

    evtSource.onerror = () => {
      if (isSearching) {
        conLine(`[${ts()}] Stream error — reconnecting...`, 'c-err');
      }
    };
  }

  function stopSearch(natural) {
    isSearching = false;
    if (evtSource) { evtSource.close(); evtSource = null; }
    searchBtn.disabled = false;
    searchBtnLabel.textContent = 'Start Scan';
    stopBtn.classList.add('hidden');
    if (!natural) conLine(`[${ts()}] Scan stopped by user.`, 'c-err');
  }

  searchBtn.addEventListener('click', startSearch);
  stopBtn.addEventListener('click', () => stopSearch(false));

  copyAllBtn.addEventListener('click', () => {
    const text = foundLinks.map(l => l.url).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      copyAllBtn.textContent = 'Copied!';
      setTimeout(() => { copyAllBtn.textContent = 'Copy All'; }, 1500);
    }).catch(() => {});
  });

  exportBtn.addEventListener('click', () => {
    const text = foundLinks.map(l => `${l.name}\t${l.url}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'fpeds_chatrooms.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });

})();
