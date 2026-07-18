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

  /* ═══════════════════════════════════════════
     CHECK TAB
  ═══════════════════════════════════════════ */
  const urlInput    = document.getElementById('url-input');
  const checkBtn    = document.getElementById('check-btn');
  const resultBox   = document.getElementById('check-result');
  const historyList = document.getElementById('history-list');
  const clearHistBtn= document.getElementById('clear-history');

  let checkHistory = JSON.parse(localStorage.getItem('fpeds_history') || '[]');

  function saveHistory() {
    localStorage.setItem('fpeds_history', JSON.stringify(checkHistory.slice(0, 40)));
  }

  function renderHistory() {
    if (checkHistory.length === 0) {
      historyList.innerHTML = '<div class="history-empty">No checks yet.</div>';
      return;
    }
    historyList.innerHTML = checkHistory.map((item, i) => {
      const cls = statusClass(item.status);
      const code = item.httpCode ? `<span class="history-code">${item.httpCode}</span>` : '';
      return `
        <div class="history-item" data-index="${i}">
          <span class="history-status ${cls}"></span>
          <span class="history-url" title="${escHtml(item.url)}">${escHtml(item.url)}</span>
          ${code}
        </div>`;
    }).join('');

    historyList.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        urlInput.value = checkHistory[el.dataset.index].url;
        runCheck();
      });
    });
  }

  function statusClass(status) {
    if (status === 'active')        return 'hs-active';
    if (status === 'inactive')      return 'hs-inactive';
    if (status === 'dead')          return 'hs-dead';
    if (status === 'tor_unavailable') return 'hs-tor';
    return 'hs-error';
  }

  function httpCodeClass(code) {
    if (!code) return '';
    if (code >= 200 && code < 300) return 'code-2xx';
    if (code >= 300 && code < 400) return 'code-3xx';
    if (code >= 400 && code < 500) return 'code-4xx';
    return 'code-5xx';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showLoading() {
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `
      <div class="result-box loading">
        <div class="loader">
          <span>Connecting</span>
          <span class="loader-dots">
            <span></span><span></span><span></span>
          </span>
        </div>
      </div>`;
  }

  function badgeHtml(status) {
    const map = {
      active:          ['badge-active',   'ACTIVE'],
      inactive:        ['badge-inactive', 'INACTIVE'],
      dead:            ['badge-dead',     'DEAD'],
      tor_unavailable: ['badge-tor',      'TOR REQUIRED'],
      error:           ['badge-error',    'ERROR'],
    };
    const [cls, label] = map[status] || ['badge-error', 'UNKNOWN'];
    return `<span class="status-badge ${cls}">${label}</span>`;
  }

  function showResult(data) {
    const isOnionBadge = data.isOnion
      ? `<span class="hint-tag onion" style="margin-left:8px">.onion</span>` : '';

    let rows = '';

    rows += row('Status', badgeHtml(data.status) + isOnionBadge);

    if (data.httpCode) {
      const cc = httpCodeClass(data.httpCode);
      rows += row('HTTP Code', `<span class="http-code ${cc}">${data.httpCode}</span>`);
    }

    rows += row('URL', `<a href="${escHtml(data.url)}" target="_blank" rel="noopener" style="color:var(--text-dim)">${escHtml(data.url)}</a>`);

    if (data.responseTime !== undefined) {
      rows += row('Response Time', data.responseTime + ' ms');
    }

    if (data.contentType && data.contentType !== 'unknown') {
      rows += row('Content-Type', data.contentType);
    }

    if (data.server && data.server !== 'unknown') {
      rows += row('Server', data.server);
    }

    if (data.message) {
      rows += row('Note', `<span style="color:var(--text-dim)">${escHtml(data.message)}</span>`);
    }

    resultBox.classList.remove('hidden');
    resultBox.innerHTML = rows;
  }

  function row(key, val) {
    return `<div class="result-row">
      <span class="result-key">${key}</span>
      <span class="result-val">${val}</span>
    </div>`;
  }

  async function runCheck() {
    let url = urlInput.value.trim();
    if (!url) return;

    // Auto-prepend protocol if missing
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
      urlInput.value = url;
    }

    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking…';
    showLoading();

    try {
      const resp = await fetch('/fpeds/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await resp.json();
      showResult(data);

      // Add to history
      checkHistory.unshift({ url: data.url || url, status: data.status, httpCode: data.httpCode });
      checkHistory = checkHistory.slice(0, 40);
      saveHistory();
      renderHistory();

    } catch (err) {
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = row('Error', `<span style="color:var(--red)">Request failed — ${escHtml(err.message)}</span>`);
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check';
    }
  }

  checkBtn.addEventListener('click', runCheck);

  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') runCheck();
  });

  clearHistBtn.addEventListener('click', () => {
    checkHistory = [];
    saveHistory();
    renderHistory();
  });

  // Initial render
  renderHistory();


  /* ═══════════════════════════════════════════
     SEARCH TAB
  ═══════════════════════════════════════════ */
  const searchBtn       = document.getElementById('search-btn');
  const searchBtnLabel  = document.getElementById('search-btn-label');
  const stopBtn         = document.getElementById('stop-btn');
  const searchStats     = document.getElementById('search-stats');
  const statQueries     = document.getElementById('stat-queries');
  const statLinks       = document.getElementById('stat-links');
  const consoleOutput   = document.getElementById('console-output');
  const foundSection    = document.getElementById('found-links-section');
  const foundLinksList  = document.getElementById('found-links-list');
  const copyAllBtn      = document.getElementById('copy-all-btn');
  const exportBtn       = document.getElementById('export-btn');

  let evtSource   = null;
  let isSearching = false;
  let foundLinks  = [];
  let queryCount  = 0;
  let totalQueries= 50;

  function conLine(text, cls) {
    const span = document.createElement('span');
    span.className = 'console-line ' + (cls || 'c-dim');
    span.innerHTML = text;
    consoleOutput.appendChild(span);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function clearConsole() {
    consoleOutput.innerHTML = '';
    foundLinksList.innerHTML = '';
    foundLinks = [];
    queryCount = 0;
    statQueries.textContent = `0/${totalQueries}`;
    statLinks.textContent   = '0';
  }

  function addFoundLink(url, name) {
    foundLinks.push({ url, name });

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
      // Switch to check tab
      document.querySelector('[data-tab="check"]').click();
      runCheck();
    });

    foundLinksList.appendChild(item);

    if (foundSection.classList.contains('hidden')) {
      foundSection.classList.remove('hidden');
    }
  }

  function startSearch() {
    if (isSearching) return;
    isSearching = true;

    clearConsole();
    searchBtn.disabled = true;
    searchBtnLabel.textContent = 'Scanning…';
    stopBtn.classList.remove('hidden');
    searchStats.classList.remove('hidden');

    consoleOutput.innerHTML = '';
    conLine(`[${timestamp()}] Initializing scan engine...`, 'c-init');

    evtSource = new EventSource('/fpeds/search');

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.type === 'start') {
        totalQueries = data.total || 50;
        conLine(`[${timestamp()}] ${escHtml(data.message)}`, 'c-init');
        conLine(`[${timestamp()}] Running ${totalQueries} queries...`, 'c-dim');
      }

      if (data.type === 'query') {
        queryCount++;
        statQueries.textContent = `${queryCount}/${totalQueries}`;
        conLine(`[${timestamp()}] ${escHtml(data.message)}`, 'c-query');
      }

      if (data.type === 'link') {
        statLinks.textContent = foundLinks.length + 1;
        conLine(`[${timestamp()}]  ↳ FOUND: <span style="color:var(--green)">${escHtml(data.url)}</span>  <span style="color:var(--text-dimmer)">${escHtml(data.name)}</span>`, 'c-link');
        addFoundLink(data.url, data.name);
      }

      if (data.type === 'done') {
        conLine(`[${timestamp()}] ─────────────────────────────────────────`, 'c-dim');
        conLine(`[${timestamp()}] ${escHtml(data.message)}`, 'c-done');
        stopSearch(true);
      }
    };

    evtSource.onerror = () => {
      conLine(`[${timestamp()}] Connection error.`, 'c-err');
      stopSearch(false);
    };
  }

  function stopSearch(natural) {
    isSearching = false;
    if (evtSource) { evtSource.close(); evtSource = null; }
    searchBtn.disabled = false;
    searchBtnLabel.textContent = 'Start Scan';
    stopBtn.classList.add('hidden');
    if (!natural) {
      conLine(`[${timestamp()}] Scan stopped.`, 'c-err');
    }
  }

  function timestamp() {
    const n = new Date();
    const hh = String(n.getHours()).padStart(2, '0');
    const mm = String(n.getMinutes()).padStart(2, '0');
    const ss = String(n.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fpeds_chatrooms.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });

})();
