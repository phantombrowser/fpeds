/* ─── fpeds — auth.js ─── */
(function () {
  'use strict';

  const isSignup  = document.getElementById('signup-form') !== null;
  const form      = document.getElementById(isSignup ? 'signup-form' : 'login-form');
  const errBox    = document.getElementById('auth-error');
  const sucBox    = document.getElementById('auth-success');
  const btn       = document.getElementById(isSignup ? 'signup-btn' : 'login-btn');
  const eyeBtn    = document.getElementById('eye-btn');
  const pwInput   = document.getElementById('f-password');

  /* show/hide password */
  if (eyeBtn && pwInput) {
    eyeBtn.addEventListener('click', () => {
      const visible = pwInput.type === 'text';
      pwInput.type  = visible ? 'password' : 'text';
      eyeBtn.textContent = visible ? 'show' : 'hide';
    });
  }

  /* password strength (signup only) */
  const pwStrength = document.getElementById('pw-strength');
  if (pwStrength && pwInput) {
    pwInput.addEventListener('input', () => {
      const v = pwInput.value;
      pwStrength.className = 'password-strength';
      if (!v) return;
      const score =
        (v.length >= 8 ? 1 : 0) +
        (/[A-Z]/.test(v) ? 1 : 0) +
        (/[0-9]/.test(v) ? 1 : 0) +
        (/[^A-Za-z0-9]/.test(v) ? 1 : 0);
      const cls = score <= 1 ? 'pw-weak' : score === 2 ? 'pw-fair' : score === 3 ? 'pw-good' : 'pw-strong';
      pwStrength.classList.add(cls);
    });
  }

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
    if (sucBox) sucBox.classList.add('hidden');
  }

  function showSuccess(msg) {
    if (!sucBox) return;
    sucBox.textContent = msg;
    sucBox.classList.remove('hidden');
    errBox.classList.add('hidden');
  }

  function setLoading(loading) {
    btn.disabled = loading;
    btn.textContent = loading ? (isSignup ? 'Creating…' : 'Signing in…') : (isSignup ? 'Create Account' : 'Sign In');
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('hidden');

      const username = document.getElementById('f-username')?.value.trim();
      const password = document.getElementById('f-password')?.value;
      const email    = document.getElementById('f-email')?.value.trim();

      if (!username || !password || (isSignup && !email)) {
        showError('Please fill in all fields.');
        return;
      }

      setLoading(true);

      try {
        const body    = isSignup ? { username, email, password } : { username, password };
        const endpoint= isSignup ? '/fpeds/signup' : '/fpeds/login';
        const resp    = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await resp.json();

        if (data.ok) {
          if (isSignup) {
            showSuccess('Account created! Redirecting…');
            setTimeout(() => { window.location.href = '/fpeds'; }, 800);
          } else {
            window.location.href = '/fpeds';
          }
        } else {
          showError(data.error || 'Something went wrong.');
          setLoading(false);
        }
      } catch (err) {
        showError('Network error — ' + err.message);
        setLoading(false);
      }
    });
  }

  /* Focus first input */
  const firstInput = document.getElementById('f-username');
  if (firstInput) firstInput.focus();
})();
