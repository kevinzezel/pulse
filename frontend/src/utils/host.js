const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function isLocalHost() {
  if (typeof window === 'undefined') return false;
  return LOOPBACK.has(window.location.hostname);
}

// Decide se o servidor está rodando na mesma máquina que o browser.
//
// Fonte canônica é `healthEntry.sameServer`: o /health do client devolve esse
// boolean computado a partir do peer IP TCP (loopback ou interface local). Se
// vier true ou false, ele é a resposta — vence até combinações counter-
// intuitivas (ex.: dashboard em https://lan-ip e client cadastrado pelo mesmo
// IP LAN, mas rodando em outra máquina via NAT).
//
// Se `healthEntry` for ausente/desconhecido (`sameServer === null` ou entry
// nula), cai no fallback histórico: só "local" quando browser E servidor estão
// ambos em loopback. Esse fallback existe pra:
//   - clientes pre-4.6 que ainda não devolvem same_server;
//   - render inicial antes do primeiro /health terminar;
//   - cenário em que o /health falhou e nunca tivemos resposta válida.
// Em 4.2.x havia um probe oculto a https://localhost:<port>/health pra
// "promover" servers LAN a local; foi removido em 4.2.9-pre por gerar CORS/
// TLS pra hosts não cadastrados e gerar falsos positivos quando outro
// processo ocupava a porta no notebook do usuário. A mesma decisão hoje vive
// na resposta do próprio client.
export function isServerLocalToBrowser(server, healthEntry = null) {
  if (typeof window === 'undefined' || !server) return false;
  const serverHost = server.host;
  if (!serverHost) return false;
  if (healthEntry && typeof healthEntry.sameServer === 'boolean') {
    return healthEntry.sameServer;
  }
  const browserHost = window.location.hostname;
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
