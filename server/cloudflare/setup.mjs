export const setupPage = `<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configurar IA Pessoal</title>
<style>
:root{color-scheme:dark}body{background:#080b12;color:#f5f7fc;font:1rem/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem}
input,button{box-sizing:border-box;font:inherit;padding:.65rem;border-radius:.55rem}input{display:block;width:100%;margin:.45rem 0 1rem}button{background:#155bcc;color:#fff;border:none}
</style>
<h1>Conectar a IA Pessoal</h1>
<p>O link de configuração pode ser usado uma vez. Abra-o no iPhone em que pretende configurar o aplicativo.</p>
<button id="activate">Gerar credencial</button>
<p id="status" role="status"></p>
<section id="credentials" hidden>
<label for="address">Endereço HTTPS</label><input id="address" readonly>
<label for="token">Credencial do proprietário</label><input id="token" readonly autocomplete="off" spellcheck="false">
<button id="copy">Copiar credencial</button>
<p>Em IA Pessoal, abra <strong>Ajustes</strong>, preencha os campos e toque em <strong>Salvar conexão</strong>. Guarde a credencial em um gerenciador de senhas antes de fechar esta página.</p>
</section>
<script>
const code = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const activate = document.getElementById('activate');
const status = document.getElementById('status');
const token = document.getElementById('token');
if (!code) {
  activate.disabled = true;
  status.textContent = 'Abra o link completo de configuração.';
}
activate.onclick = async () => {
  activate.disabled = true;
  try {
    const response = await fetch('/pair', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    const data = await response.json();
    if (!response.ok) { status.textContent = data.error; activate.disabled = false; return; }
    document.getElementById('address').value = location.origin;
    token.value = data.token;
    document.getElementById('credentials').hidden = false;
    activate.hidden = true;
    status.textContent = 'Credencial criada. Ela fica visível somente nesta página.';
  } catch {
    status.textContent = 'A conexão falhou. Confira a rede antes de tentar novamente.';
    activate.disabled = false;
  }
};
document.getElementById('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(token.value); status.textContent = 'Credencial copiada.'; }
  catch { token.focus(); token.select(); status.textContent = 'Copie a credencial selecionada.'; }
};
</script>
</html>`;
