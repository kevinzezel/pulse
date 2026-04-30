const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function isLocalHost() {
  if (typeof window === 'undefined') return false;
  return LOOPBACK.has(window.location.hostname);
}

// Retorna true somente quando browser e servidor são ambos loopback
// (localhost / 127.0.0.1 / ::1). Servidor cadastrado por IP LAN é tratado
// como remoto, mesmo que fisicamente rode na mesma máquina — não há mais
// detecção ativa por probe a localhost (4.2.x tinha; foi removido em
// 4.2.9-pre por gerar requisições/CORS/TLS para um host não cadastrado e
// causar falsos positivos quando outro processo usava a mesma porta no
// notebook do usuário). Quem quiser comportamento "local editor" cadastra o
// servidor explicitamente como localhost / 127.0.0.1 e abre o dashboard pelo
// mesmo loopback.
export function isServerLocalToBrowser(server) {
  if (typeof window === 'undefined' || !server) return false;
  const browserHost = window.location.hostname;
  const serverHost = server.host;
  if (!serverHost) return false;
  return LOOPBACK.has(browserHost) && LOOPBACK.has(serverHost);
}

// Monta URL vscode://vscode-remote pra abrir a pasta da sessão no VS Code do
// browser via Remote-SSH. Target do ssh-remote:
//   - server.sshAlias (se preenchido) — permite o VS Code casar com um bloco
//     Host do ~/.ssh/config do usuário (User, IdentityFile, Port, etc).
//     Necessário quando o servidor usa chave SSH customizada (ssh -i).
//   - server.host (fallback) — funciona pra setups com chave default.
// cwd é codificado por segmento: preserva '/' e escapa espaço/'#'/'?'/etc.
export function buildRemoteEditorUrl(server, cwd) {
  const target = (server?.sshAlias && server.sshAlias.trim()) || server?.host;
  if (!target || !cwd) return null;
  const encoded = cwd.split('/').map(encodeURIComponent).join('/');
  return `vscode://vscode-remote/ssh-remote+${target}${encoded}`;
}
