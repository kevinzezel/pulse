# Sistema de notificações idle do Pulse

Documentação técnica do alerta "terminal ocioso" — como funciona ponta-a-ponta entre frontend e client (Python).

## Visão geral

O Pulse monitora cada sessão tmux com `notify_on_idle=True` e dispara um alerta quando ela passa do `idle_timeout_seconds` sem mudanças visíveis no pane. Os alertas vão para dois canais (configuráveis): WebSocket do navegador (que vira toast + push) e Telegram (mensagem com snippet do output).

A parte mais delicada é o **anti-spam**: tem várias regras que suprimem alerta em cenários específicos (mid-composition, dedup por hash, "tô olhando"), porque sem elas o sistema viraria spam constante quando você está usando agentes interativos como Claude Code, Cursor ou Gemini CLI.

## Componentes

| Componente | Onde | Função |
|---|---|---|
| `notification_watcher` | `client/src/resources/notifications.py:117` | Asyncio task única que roda a cada 5s, captura o pane via tmux, aplica as 5 regras e decide se notifica |
| `notification_broadcast` | `client/src/resources/notification_broadcast.py` | Set de WebSockets conectados em `/ws/notifications` — envio paralelo via `asyncio.gather` |
| Heartbeat de viewing | `frontend/src/components/TerminalPane.jsx:367` | Cada `<TerminalPane>` manda `{type: 'viewing'}` a cada 10s no WS do terminal quando 4 condições são verdadeiras |
| `_state[sid]` (watcher) | `client/src/resources/notifications.py:67` | Estado in-memory do watcher (hash, last_output_ts, notified flag, last_notified_hash) |
| `sessions[sid]` (terminal) | `client/src/resources/terminal.py:34` | Dict canônico da sessão (group, project, last_viewing_ts, bytes_since_enter, etc.) |

## Fluxo de dados

```
Frontend                         Backend (client)                 Canais
────────                         ────────────────                 ──────
TerminalPane (visível)           sessions[sid].last_viewing_ts
  ├─ a cada 10s, se 4 cond ──→   atualizado em terminal.py:580
  │  envia {type:'viewing'}
  │  pelo WS do terminal
  ▼
                                 notification_watcher (loop 5s)
                                 ├─ snapshot de sessions
                                 ├─ capture-pane via tmux
                                 ├─ md5 do conteúdo
                                 ├─ aplica Rules 1-5
                                 │  (Rule 5 lê last_viewing_ts)
                                 ├─ se passar tudo:
                                 │  ├─ broadcast({type:'idle',...})  ──→ navegador (WS)
                                 │  └─ send_telegram_message(...)    ──→ Telegram
                                 └─ marca state.notified=True
```

## As 5 regras do watcher (em ordem)

Implementadas em `client/src/resources/notifications.py:175-295`. Para cada sessão monitorada, o watcher calcula o hash do `capture-pane` e roda na ordem:

### Pré-checks (antes das regras)

- **Linha 190-202** — Estado novo: cria baseline `{hash, last_output_ts:0, …}` e segue. Importante: `last_output_ts=0` significa "nunca observei mudança real"; uma sessão dormente recém-marcada com `notify_on_idle=True` **não** vai falsamente alertar.
- **Linha 204-208** — Hash mudou: atualiza `last_output_ts=now`, reseta `notified=False`, segue. Toda saída nova "renova" a contagem de idle.
- **Linha 210-211** — Já alertou nesse streak (`notified=True`): segue. Garante 1 alerta por sequência idle.

### Rule 1 — Exige saída real observada (linha 218-219)

```python
if last_output <= 0:
    continue
```

Uma sessão "fresca" (sem mudança de hash desde que o watcher começou a observar) nunca pode alertar. Cobre o caso "habilitei `notify_on_idle` num terminal já parado há 1h" — sem esse check, ele alertaria imediatamente.

### Rule 2 — Suprime se mid-composition (linha 229-230)

```python
if sess.get("bytes_since_enter", 0) > 0:
    continue
```

`bytes_since_enter` é mantido pelo handler do WS de input em `terminal.py:560-579`:
- Zerado em `\r` ou `\n` (Enter pressionado).
- Zerado em `Ctrl+C` (`\x03`) ou `Ctrl+D` (`\x04`).
- Não conta escape sequences (`\x1b[...`) — setas, F-keys, etc. são ignoradas (Rule 5 nova de v1.7.x).
- Incrementado em qualquer outro byte.

Cenário: você digita `git commit -m "long message`, pensa um pouco antes de fechar a aspa e dar Enter. Sem Rule 2, o `idle_timeout` passaria e você receberia alerta de um terminal que está ativo no compose. Com Rule 2, qualquer caractere pendente no buffer suprime o alerta.

Há também o endpoint `POST /sessions/{id}/send-text` em `routes/terminal.py` que reflete a mesma lógica (drafts do compose) — sem isso, draft sem Enter alertava falso (corrigido em v1.8.0).

### Rule 3 — Idle timeout não atingido (linha 233-235)

```python
idle_seconds = now - last_output
if idle_seconds < idle_timeout:
    continue
```

`idle_timeout` vem de `get_idle_timeout()` em `resources/settings.py`. Range válido: 15-3600s (default 30s). Mínimo absoluto: 15s — qualquer valor abaixo é clampeado em runtime durante `load_settings()` e persistido de volta no JSON.

Por que mínimo de 15s? Porque é o `VIEWING_GRACE_SECONDS` da Rule 5 — se o timeout fosse menor que o grace, a interação faria sentido degenerada (o heartbeat nunca conseguiria suprimir).

### Rule 4 — Dedup por hash (linha 242-245)

```python
if (state["last_notified_hash"] == h
        and (now - state["last_notified_ts"]) < NOTIFIED_HASH_TTL_SECONDS):
    state["notified"] = True
    continue
```

`NOTIFIED_HASH_TTL_SECONDS = 1800` (30 min). Cenário: agente parou no mesmo prompt visual ("`Continue?`"); você responde, agente trabalha 5s, volta exatamente pra mesma tela. Sem Rule 4, isso geraria 2 alertas idênticos consecutivos. Com Rule 4, o segundo é suprimido por até 30 min.

### Rule 5 — "Tô olhando" / heartbeat (linha 247-253)

```python
last_viewing = sess.get("last_viewing_ts", 0)
if last_viewing > 0 and (now - last_viewing) < VIEWING_GRACE_SECONDS:
    continue
```

`VIEWING_GRACE_SECONDS = 15`. Se o frontend mandou heartbeat nos últimos 15s, suprime alerta — o usuário está vendo o terminal, não precisa ser notificado dele. Importante: **não marca `notified=True`**. Quando o usuário sair de cena (parar de mandar heartbeat), a próxima rodada do watcher avalia normal — o alerta volta a poder disparar imediatamente após o grace expirar.

## Heartbeat de viewing (frontend)

Implementação em `frontend/src/components/TerminalPane.jsx:367-390` (heartbeat) e `:357-365` (IntersectionObserver).

### As 4 condições (todas devem ser verdadeiras)

```js
if (document.visibilityState !== 'visible') return;     // aba visível
if (!document.hasFocus()) return;                       // janela em foco
if (!intersectingRef.current) return;                   // terminal na viewport
if (Date.now() - lastUserActivityTs > 30000) return;    // user ativo nos últimos 30s
```

`lastUserActivityTs` é atualizado por listeners globais em `mousemove`, `keydown`, `pointerdown`, `wheel`, `touchstart` (linha 20-26). É **module-level**, compartilhado por todos os `<TerminalPane>` da página — ou seja, atividade em qualquer canto do app (inclusive sidebar, modal) conta como "user ativo".

`intersectingRef` é atualizado pelo `IntersectionObserver` (threshold 0.1) que observa o `<div ref={slotRef}>` onde o xterm é renderizado.

### Bootstrap síncrono do IntersectionObserver

A partir de v1.9.2, o `intersectingRef` inicializa em `false` (em vez do antigo `true` otimista) e o effect lê `slot.getBoundingClientRect()` síncrono no mount para decidir o valor inicial. Isso resolve um race que aparecia quando o `<TerminalPane>` re-montava após mover terminal entre grupos:

- Antigo: `useRef(true)` → IO podia disparar callback inicial com `isIntersecting=false` se o slot tinha rect zero (flex layout não consolidado), e ficava preso lá porque a transição "rect zero → rect cheio" não cruza o threshold de 0.1.
- Novo: `useRef(false)` + `getBoundingClientRect()` no mount → se o slot já tem altura, considera visível imediatamente; se não tem, espera o IO disparar normalmente.

Adicionalmente, `sendHeartbeat()` faz reconciliação a cada 10s — se `intersectingRef.current === false` mas o slot tem `rect > 0`, recupera o estado. Custo: um `getBoundingClientRect` por ciclo de 10s só quando o ref está false. Trivial.

## terminalCache (module-level no frontend)

`frontend/src/components/TerminalPane.jsx:10`:
```js
const terminalCache = new Map();
```

Chave: `session.id` (composite `serverId::backendId`, estável por toda a vida da sessão).

Valor: `{ terminal, fitAddon, ws, container, onDataDisposable, resizeObserver, removeTouchHandlers }`.

**Por que existe**: o `react-mosaic` re-monta tiles agressivamente (qualquer reorganização da árvore desmonta e monta de novo o tile React). Sem o cache, cada mudança de layout fecharia o WebSocket e recriaria o xterm — perdendo scrollback, conexão, estado da PTY. O cache mantém a instância xterm + WS vivas e re-anexa o container DOM no novo slot quando o `<TerminalPane>` remonta.

**Implicações no ciclo de vida**:
- WS sobrevive a remount → `bytes_since_enter`, `last_input_ts`, `last_enter_ts` todos preservados (são gravados pelo handler do WS de input).
- Heartbeat **não** sobrevive a unmount: o `setInterval` está em `useEffect`, cleanup roda no unmount. Quando remonta, novo interval é criado.
- xterm e onData disposable: preservados.

**Ponto de invalidação**:
- `destroyTerminal(id)` em `:34-45` — fecha WS + dispose xterm + remove do cache. Chamado em kill, session-ended, reconnect.
- `destroyAllTerminals()` em `:28-32` — limpa o Map inteiro. Chamado pelo botão "Wifi" na sidebar (forçar reconexão).
- `destroyTerminalsByServerId(serverId)` em `:47-55` — limpa só os terminais de um servidor específico. Chamado quando os campos de conexão de um servidor mudam (host/port/apiKey).

## Configuração

### `data/settings.json` (no client)

```json
{
  "telegram": { "bot_token": "...", "chat_id": "..." },
  "notifications": {
    "idle_timeout_seconds": 30,
    "channels": ["browser", "telegram"]
  },
  "editor": { "binary_override": "" }
}
```

- `idle_timeout_seconds`: range 15-3600. Clamp automático em load (com persist back).
- `channels`: subconjunto de `["browser", "telegram"]`. Vazio = nenhum canal.
- Escrita atômica via `os.replace()` em `resources/settings.py:41-46`.

### `notify_on_idle` per-session

Por sessão tmux, via tmux user option `@notify_on_idle__<INSTANCE_ID>` (ver `client/src/tools/tmux.py`). O `<INSTANCE_ID>` isola múltiplas instâncias do client rodando contra os mesmos terminais (cenário do Telegram dup que foi corrigido em commit `5be735b`).

Mutado pelo endpoint `PATCH /sessions/{id}/notify` em `routes/terminal.py`, que também chama `reset_session_state(sid)` para limpar o `_state[sid]` do watcher.

### `last_viewing_ts` (in-memory, sem persistência)

Vive em `sessions[session_id]["last_viewing_ts"]` no client. Não é persistido em disco — perdido em cada restart do client. Não tem problema: se o user estiver olhando, o frontend repopula em ≤10s.

A partir de v1.9.2, também é tocado por `PATCH /sessions/{id}/group` (defense-in-depth — ver gotcha #1 abaixo).

## Casos extremos & gotchas

### 1. Mover terminal entre grupos

**Sintoma resolvido em v1.9.2:** mover terminal de "Sem grupo" pra "Teste" causava notificação mesmo com terminal visível em tela após o move.

**Mecanismo:** `frontend/src/app/(main)/page.js:210-219` filtra sessões pelo `selectedGroupId` ativo. Quando `s.group_id` muda, o terminal sai do `sessionsInSelectedGroup` da tela atual → `<TerminalPane>` desmonta → cleanup faz `clearInterval(id)` do heartbeat. Quando o user troca pro grupo destino e clica no terminal pra abrir, o `<TerminalPane>` remonta, mas o `IntersectionObserver` podia ficar preso em `isIntersecting=false` (flex layout não consolidado no commit do mount).

**Mitigação em 2 camadas:**
- Frontend: bootstrap síncrono via `getBoundingClientRect()` no mount + reconciliação no `sendHeartbeat`.
- Backend: `assign_group` toca `last_viewing_ts = time.time()` ao mover, dando 15s de grace defensivo.

### 2. Race do IntersectionObserver no remount (geral)

Qualquer cenário onde o `<TerminalPane>` desmonta/remonta com slot momentaneamente sem altura (drag-resize de splits no react-mosaic, troca de aba do mosaic, layout dinâmico) tem risco de o IO disparar callback inicial com `false` e ficar preso. A reconciliação por `getBoundingClientRect` no `sendHeartbeat` (ver acima) cobre — mas vale lembrar que isso é fragilidade arquitetural do `IntersectionObserver` em geral, não específico do Pulse.

### 3. Múltiplas abas no mesmo browser

Cada aba é independente (per-tab UUID via `rt:tab-uuid` em sessionStorage — v1.9.0). Cada `<TerminalPane>` em qualquer aba que tenha visibilidade + foco + viewport + atividade manda heartbeat. **Dedup natural no backend**: `last_viewing_ts` só guarda o timestamp mais recente, então qualquer uma das abas suprimindo já é suficiente.

### 4. WS substituído (código 4000)

O backend só permite 1 WS por sessão (`_active_ws[session_id]` em `client/src/resources/terminal.py:35`). Conexão nova fecha a antiga com código 4000 "Replaced by new connection". A aba antiga perde o WS imediatamente, heartbeat para nela. A nova aba assume — desde que ela esteja com as 4 condições satisfeitas.

### 5. Compose drafts via `/send-text`

`POST /sessions/{id}/send-text` reflete a mesma lógica do handler de input (`routes/terminal.py`) sobre `bytes_since_enter`. Sem isso, draft pré-popular sem Enter (ex: `git commit -m "..."` revisar antes de enviar) disparava alerta falso. Corrigido em v1.8.0.

### 6. Telegram bloqueando event loop

`send_telegram_message` usa `urllib.request.urlopen` síncrono com timeout de 10s. Se o Telegram tiver lento, o event loop do Python congelava — todos os WebSockets travavam. Corrigido em v1.8.0 envolvendo em `asyncio.to_thread`.

### 7. `capture_pane` lento crônico

Antes era silenciado junto com `FileNotFoundError` — sem alerta + sem log = caçar agulha no palheiro. Corrigido em v1.8.0 com `except subprocess.TimeoutExpired` separado e `logger.warning`.

### 8. Watcher snapshot é cópia rasa

`monitored_snapshot = {sid: dict(sessions[sid])}` em `notifications.py:135` faz **shallow copy**. Suficiente porque os campos lidos (`last_viewing_ts`, `bytes_since_enter`, etc.) são primitivos. Se alguma vez precisar ler um sub-dict mutável, vai precisar de `copy.deepcopy` — não é o caso hoje.

## Constantes de referência (com paths)

| Constante | Valor | Onde |
|---|---|---|
| `WATCHER_INTERVAL_SECONDS` | `5` | `client/src/resources/notifications.py:9` |
| `CAPTURE_LINES` | `100` | `client/src/resources/notifications.py:10` |
| `SNIPPET_MAX_LINES` | `20` | `client/src/resources/notifications.py:11` |
| `SNIPPET_MAX_CHARS` | `3500` | `client/src/resources/notifications.py:12` |
| `NOTIFIED_HASH_TTL_SECONDS` | `1800` | `client/src/resources/notifications.py:17` |
| `VIEWING_GRACE_SECONDS` | `15` | `client/src/resources/notifications.py:22` |
| `TIMEOUT_MIN` | `15` | `client/src/resources/settings.py:13` |
| `TIMEOUT_MAX` | `3600` | `client/src/resources/settings.py:14` |
| `DEFAULT_TIMEOUT` | `30` | `client/src/resources/settings.py:15` |
| `VIEWING_HEARTBEAT_MS` | `10000` | `frontend/src/components/TerminalPane.jsx:17` |
| `USER_ACTIVITY_THRESHOLD_MS` | `30000` | `frontend/src/components/TerminalPane.jsx:18` |

## Para futuras alterações (checklist)

### Adicionar nova condição no heartbeat (frontend)

1. Adicionar a condição no `sendHeartbeat` em `TerminalPane.jsx:367-390` antes do `ws.send`.
2. Considerar se a condição precisa de cleanup (ex: novo listener global).
3. Atualizar a seção "As 4 condições" deste doc.

### Adicionar nova regra no watcher (backend)

1. Posicionar a nova regra em `notifications.py:175-295` na ordem certa (regras que **só suprimem** podem vir depois das que **rejeitam de vez**).
2. Decidir: vai marcar `state["notified"] = True` (alerta consumido) ou não (alerta apenas adiado)?
3. Documentar a regra aqui na seção "As 5 regras" (atualizando para "As 6 regras", etc.).

### Mudar `VIEWING_GRACE_SECONDS`

- Constraint: `VIEWING_GRACE_SECONDS >= VIEWING_HEARTBEAT_MS / 1000` (10s) com folga. Caso contrário, jitter de rede entre 2 heartbeats consecutivos pode fazer o watcher "esquecer" momentaneamente.
- Constraint: `TIMEOUT_MIN >= VIEWING_GRACE_SECONDS`. Atualmente os dois são 15s. Se aumentar grace, aumentar `TIMEOUT_MIN` junto.

### Adicionar canal de notificação novo (ex: Discord, Slack)

1. Adicionar em `VALID_CHANNELS` em `client/src/resources/settings.py:17`.
2. Implementar `tools/<canal>.py` com função `send_<canal>_message(creds, msg)`.
3. Adicionar branch no watcher em `notifications.py:259-295`.
4. Atualizar UI em `frontend/src/components/settings/NotificationsTab.jsx`.
5. Atualizar i18n (`pt-BR.json`, `en.json`, `es.json`).

### Mover heartbeat pra fora do `<TerminalPane>`

Tentação: mover o `setInterval` pra um hook global que itera `terminalCache` e manda `viewing` em todos os WS abertos, desacoplando do ciclo de vida React.

**Cuidado**: o `IntersectionObserver` precisa de um DOM node mounted pra funcionar. Sem `<TerminalPane>` montado não dá pra saber se o terminal está "na viewport". A condição "tô olhando" se reduziria a "WS aberto + janela focada + atividade recente" — semanticamente diferente do atual.

Decisão atual (v1.9.2): manter heartbeat dentro do componente, com IO bootstrap robusto + grace no backend pra cobrir a janela de unmount/remount.

## Checklist de verificação ao mexer no sistema

1. Reproduz o cenário do bug original (terminal visível em "Sem grupo", mover pra "Teste", abrir lá, esperar idle): **NÃO DEVE NOTIFICAR**.
2. Reproduz "tô olhando padrão": terminal visível, esperar idle: **NÃO DEVE NOTIFICAR**.
3. Reproduz "saí da tela": minimizar / trocar de aba / sair pra outro grupo, esperar idle: **DEVE NOTIFICAR**.
4. Reproduz mid-composition: digitar parcial sem Enter, esperar idle: **NÃO DEVE NOTIFICAR**.
5. Reproduz dedup: agente alerta, responder, agente volta pro mesmo prompt: **NÃO DEVE NOTIFICAR de novo dentro de 30 min**.
6. Reproduz fresh enable: marcar `notify_on_idle` numa sessão dormente: **NÃO DEVE NOTIFICAR até a próxima saída real do tmux**.

Se algum desses quebrar, voltar pra este doc, identificar qual regra falhou, e corrigir.
