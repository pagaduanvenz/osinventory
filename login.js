(function () {
  var apiInput = document.getElementById('api-url');
  var savedUrl = localStorage.getItem('onesecai_api_url');
  if (savedUrl) apiInput.value = savedUrl;

  var form = document.getElementById('login-form');
  var errorEl = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');

  // If already signed in, skip straight to the app.
  if (localStorage.getItem('onesecai_user') && savedUrl) {
    window.location.href = 'index.html';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.hidden = true;

    var apiUrl = apiInput.value.trim();
    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;

    if (!apiUrl) {
      errorEl.textContent = 'Paste your Google Apps Script web app URL first.';
      errorEl.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    fetch(apiUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'login', username: username, password: password })
    })
      .then(function (res) { return res.json(); })
      .then(function (res) {
        if (res.ok && res.data && res.data.ok) {
          localStorage.setItem('onesecai_api_url', apiUrl);
          localStorage.setItem('onesecai_user', JSON.stringify(res.data.user));
          window.location.href = 'index.html';
        } else {
          var msg = (res.data && res.data.error) || res.error || 'Sign-in failed. Check your credentials.';
          errorEl.textContent = msg;
          errorEl.hidden = false;
          btn.disabled = false;
          btn.textContent = 'Sign in';
        }
      })
      .catch(function (err) {
        errorEl.textContent = 'Could not reach the API. Check the URL and that the Apps Script is deployed.';
        errorEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Sign in';
      });
  });
})();
