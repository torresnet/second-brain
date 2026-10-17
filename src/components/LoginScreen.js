import { signInWithPassword } from '../shared/services/supabaseClient.js';

export function createLoginScreen() {
  const screen = document.createElement('div');
  screen.className = 'login-screen';
  screen.style.display = 'none';

  screen.innerHTML = `
    <form class="login-card" id="login-form" autocomplete="on">
      <div class="brand-mark login-logo" aria-hidden="true">SC</div>
      <h1 class="login-title">Segundo Cérebro</h1>
      <p class="login-subtitle">Acesso restrito. Entre para continuar.</p>

      <label class="login-label" for="login-email">E-mail</label>
      <input id="login-email" name="email" type="email" class="search-input login-input"
             autocomplete="username" required />

      <label class="login-label" for="login-password">Senha</label>
      <input id="login-password" name="password" type="password" class="search-input login-input"
             autocomplete="current-password" required />

      <div id="login-error" class="login-error" role="alert" style="display: none;"></div>

      <button type="submit" id="login-submit" class="btn-primary login-submit">Entrar</button>
    </form>
  `;

  document.body.appendChild(screen);

  const form = screen.querySelector('#login-form');
  const emailInput = screen.querySelector('#login-email');
  const passwordInput = screen.querySelector('#login-password');
  const errorBox = screen.querySelector('#login-error');
  const submitBtn = screen.querySelector('#login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.innerText = 'Entrando...';

    try {
      await signInWithPassword(emailInput.value.trim(), passwordInput.value);
      passwordInput.value = '';
    } catch (err) {
      errorBox.innerText = 'E-mail ou senha inválidos.';
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Entrar';
    }
  });

  return {
    show() {
      screen.style.display = 'flex';
      emailInput.focus();
    },
    hide() {
      screen.style.display = 'none';
    }
  };
}
