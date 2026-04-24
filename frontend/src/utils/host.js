const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function isLocalHost() {
  if (typeof window === 'undefined') return false;
  return LOOPBACK.has(window.location.hostname);
}

// Retorna true somente quando temos certeza sem probe de que browser e server
// rodam na mesma máquina: ambos loopback (localhost / 127.0.0.1 / ::1). Qualquer
// outro caso ambíguo (browser em IP LAN acessando server do mesmo IP — que pode
// ser o desktop ou outro notebook na mesma LAN, sem garantia) não conta como
// local aqui. Quem resolve essa ambiguidade é o probe assíncrono feito pelo
// ServersProvider: ele tenta `http(s)://localhost:<port>/api/sessions` com a
// apiKey e, se a mesma instância responder, marca o server como "local-
// reachable" no cache — combinado com isto via `isServerLocal(server)`.
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
