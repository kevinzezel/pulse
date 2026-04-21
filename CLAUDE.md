# Pulse

Dashboard web que multiplexa sessões tmux no host. *Keep your terminals alive* — as sessões persistem no servidor; cliente conecta/reconecta via WebSocket sem perder estado.

## Arquitetura

- **frontend**: Next.js 15 (App Router) + React 19 + Tailwind 3 + xterm.js + react-mosaic
- **client** (ex-backend): FastAPI (Python) + tmux via subprocess + WebSockets. É o agente que roda onde há terminais a gerenciar — localmente ou num servidor remoto.
- **tmux**: cria e mantém as sessões reais; sobrevivem a reconexões e restart do client (reconstruídas via `recover_sessions()`)

## Estrutura

```
pulse/
├── client/src/
│   ├── service.py              # FastAPI app + handler de AppException
│   ├── routes/terminal.py      # endpoints HTTP + WS
│   ├── resources/terminal.py   # lógica de sessões + websocket_terminal()
│   ├── tools/tmux.py           # wrappers do tmux CLI
│   └── system/
│       ├── log.py              # AppException(key, params, status_code)
│       └── i18n.py             # catálogo pt-BR/en/es + build_i18n_response()
└── frontend/src/
    ├── app/
    │   ├── layout.js           # script anti-FOUC (tema+locale)
    │   ├── InnerLayout.js      # ThemeProvider + I18nProvider + Toaster
    │   └── page.js             # Dashboard principal
    ├── components/             # Header, Sidebar, TerminalMosaic, TerminalPane, ...
    ├── providers/              # ThemeProvider, I18nProvider (useTranslation, useErrorToast)
    ├── themes/
    │   ├── themes.js           # registry dos 16 temas (id/label/base)
    │   ├── terminal.css        # CSS vars HSL (:root + .dark + .theme-<id>)
    │   └── xterm.js            # paletas xterm por tema
    ├── i18n/locales/           # pt-BR.json, en.json, es.json
    ├── services/api.js         # injeta Accept-Language, propaga detail_key
    └── utils/mosaicHelpers.js  # manipulação da árvore do react-mosaic
```

## Sistema de cores (temas)

**Nunca usar cor hex hardcoded em JSX.** Sempre um token.

Tokens definidos em `frontend/src/themes/terminal.css`:
- `:root` = tema light default
- `.dark` = tema dark default (fixado no `<html>` por padrão)
- `.theme-<id>` = sobrescreve tokens para temas customizados (Dracula, Nord, Tokyo Night, etc.)

Tokens disponíveis (cada um é `H S% L%` sem `hsl()` wrapper, consumido via `hsl(var(--x))`):
- Base shadcn: `background`, `foreground`, `card[-foreground]`, `primary[-foreground]`, `muted[-foreground]`, `accent[-foreground]`, `destructive[-foreground]`, `border`, `input`, `ring`
- App: `terminal`, `terminal-header`, `terminal-border`, `sidebar-bg`, `sidebar-border`
- Semânticos: `success` (em vez de `text-green-400`), `overlay` (em vez de `bg-black/60`)
- Gradient: `bg-brand-gradient` (classe custom = `linear-gradient(to right, hsl(var(--brand-gradient-from)), hsl(var(--brand-gradient-to)))`)

Consumo preferido: classes Tailwind (`bg-primary`, `text-muted-foreground`, `bg-terminal`, `bg-sidebar`, `text-success`, `bg-overlay/60`). Quando um token não está exposto no Tailwind, use inline: `style={{ background: 'hsl(var(--x))' }}`.

### xterm.js

Os terminais têm paleta própria — 16 objetos em `frontend/src/themes/xterm.js` (um por tema). `TerminalPane` aplica via `terminal.options.theme` ao criar e usa `applyXtermThemeToAll(theme)` em effect quando o tema muda.

### Adicionar um novo tema

Três passos mecânicos:
1. Bloco `.theme-<id> { --primary: ...; --background: ...; ... }` em `terminal.css` (copiar estrutura de outro tema; ~20 vars)
2. Entrada `'<id>': { background, foreground, cursor, selectionBackground, black, red, green, yellow, blue, magenta, cyan, white, brightBlack, ... }` em `XTERM_THEMES` em `xterm.js`
3. Item `{ id, label, base: 'dark' | 'light' }` em `THEMES` em `themes.js`

`ThemeSelector` descobre automaticamente.

### Persistência

Tema em `localStorage.rt:theme`. Script inline em `app/layout.js` (lado server → string inline no `<head>`) lê e aplica classe antes da hidratação para evitar FOUC. A lista de IDs é injetada no build via `JSON.stringify(DARK_IDS)` / `LIGHT_IDS`.

## Sistema de i18n

3 idiomas: **en (default), pt-BR, es**. Solução custom, sem lib externa. (Projeto internacional — strings voltadas ao público externo são escritas em inglês.)

### Frontend

Chaves aninhadas em `frontend/src/i18n/locales/{pt-BR,en,es}.json` (ex: `sidebar.newTerminal`, `modal.confirmKill.message`).

Hook único:
```js
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';

const { t, locale, setLocale, formatTime, formatDate } = useTranslation();
t('sidebar.newTerminal')                              // simples
t('modal.confirmKill.message', { id: 'term-1' })      // com interpolação {id}
formatTime(new Date())                                // Intl.DateTimeFormat com locale ativo

const showError = useErrorToast();
try { ... } catch (err) { showError(err); }           // já traduz via detail_key
```

Persistência: `localStorage.rt:locale`. Default inicial: `navigator.language` com fallback para en. O `<html lang>` é atualizado em runtime pelo provider.

Export extra: `getCurrentLocale()` (var de módulo) — usado em `services/api.js` para injetar `Accept-Language` em cada fetch sem precisar de hook.

### Client (backend)

Catálogo espelhado em `client/src/system/i18n.py` com função `translate(key, locale, **params)` e `parse_accept_language(header)`.

Erros sempre via `AppException`:
```python
raise AppException(key="errors.session_not_found", status_code=404)
raise AppException(key="errors.session_not_found", status_code=404, extra="something")
```

Sucesso via `build_i18n_response`:
```python
return build_i18n_response(request, 200, {
    "detail_key": "success.session_created",
    "session": {...}
})
```

O handler central lê `Accept-Language`, resolve e devolve `{detail, detail_key, detail_params}`. O frontend prefere `detail_key` quando presente.

### Adicionar chave

1. Nova chave nos 3 JSONs do frontend (manter estrutura aninhada).
2. Se a mensagem vem do client: adicionar **mesma chave** em `i18n.py` (dict plano).
3. No código: `t('chave')` no front, `AppException(key='chave')` ou `detail_key` no client.

### ATENÇÃO — WebSocket close reasons

As strings `"Session ended"`, `"Replaced by new connection"`, `"Session not found"`, `"tmux session not found"` em `resources/terminal.py` são **contrato** front↔client, não UI. Ficam em inglês. O front (`TerminalPane.jsx`) faz match exato por string e só aí dispara o toast traduzido. Não traduzir no client.

## Convenções de código

- Nunca hex/rgba hardcoded em JSX/CSS novo — sempre um token (ou cria token novo se justificar)
- Nunca string de UI hardcoded — sempre `t('chave')`
- Erros de API: `raise AppException(key=..., status_code=...)`, nunca `JSONResponse(status_code=X, content={"detail": "..."})` inline
- `localStorage` keys: sempre prefixo `rt:` (ex: `rt:theme`, `rt:locale`, `rt:mosaicLayout`, `rt:sidebarOpen`)
- Acesso a dict no Python: `d["key"]` quando chave obrigatória, `d.get("key", default)` só com default real
- Variáveis de ambiente: `os.environ["VAR"]` para obrigatórias, `os.environ.get("VAR", default)` só com default real
- Sem emojis em código a menos que peça explicitamente

## Áreas críticas

- **`frontend/src/components/TerminalPane.jsx`** — `terminalCache` é Map module-level (fora do React) para preservar instâncias xterm + WebSocket quando o react-mosaic re-monta componentes. Use `destroyTerminal(id)` ou `destroyAllTerminals()` (re-conectar tudo).
- **`frontend/src/app/page.js`** — `reconnectKey` em `<TerminalMosaic key={reconnectKey}>` força remount de toda a árvore; usado pelo botão "Wifi" na sidebar quando o celular rouba a conexão.
- **`client/src/resources/terminal.py`** — `sessions` dict é in-memory. `_active_ws` também. `recover_sessions()` reconstrói `sessions` lendo o tmux no startup (sobrevive a restart do client, sessões tmux continuam rodando).
- **`_active_ws[session_id]`** — só um WS por sessão. Conexão nova fecha a antiga com código 4000 `"Replaced by new connection"`.

## Como rodar

Orquestrador (sobe ambos):
```
./start.sh
```

Client só:
```
./client/start.sh [--reload]
```

Frontend só:
```
./frontend/start.sh [--dev | --prod]
```

### Envs obrigatórias

Sem fallback — se faltar env, os scripts abortam com mensagem clara. Os `start.sh` copiam `.env.example` → `.env` na primeira execução.

- `client/.env` (gitignored): `COMPOSE_PROJECT_NAME`, `VERSION`, `API_HOST`, `API_PORT`, `API_KEY`
- `frontend/.env` (gitignored): `WEB_HOST`, `WEB_PORT`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`, `AUTH_COOKIE_SECURE`

Config de servidores do frontend continua em `frontend/data/servers.json` (gerenciada pela tela Settings → Servidores), não em env.

### Autenticação do frontend

Gate de senha única + JWT HS256 24h em cookie httpOnly `rt:auth`. `AUTH_PASSWORD` é a senha compartilhada; `AUTH_JWT_SECRET` é auto-gerado pelo `start.sh` se estiver `change-me` ou ausente. `/login` e `/api/auth/*` são as únicas rotas públicas — `src/middleware.js` protege tudo o resto (UI + API). Cada API route com dados sensíveis (`/api/servers|groups|prompts`) também é envolvida por `withAuth()` de `@/lib/auth` (defense-in-depth / DAL).

Em prod (atrás de NGINX/Cloudflare com TLS), manter `AUTH_COOKIE_SECURE=true`. Em dev local sem HTTPS, `AUTH_COOKIE_SECURE=false` — caso contrário o browser descarta o cookie. Recomenda-se também strip do header `x-middleware-subrequest` no proxy (defesa contra futuras variantes do CVE-2025-29927).

## Verificação antes de commitar

- `cd frontend && npm run build` — type-check + compile
- `cd client/src && python3 -c "import service"` — import smoke test
- Teste manual: trocar tema + idioma no Header, criar sessão, reconectar em outra aba (pra testar código 4000)

## Fluxo de release — instrução pro Claude

Sempre que terminar mudanças visíveis ao usuário final (features, bug fixes, novos comandos da CLI, mudanças de UI, alteração no installer, qualquer coisa que mereça aparecer no CHANGELOG), ao final da resposta **devolver um bloco com os comandos git para publicar a release**, mesmo que o usuário não peça. Exceções: mudanças puramente internas (comentários, refactor silencioso, tipagem) — essas apenas mencionar brevemente e **não** propor release.

O bloco deve conter, nesta ordem:

1. **Bump de versão** sugerido, seguindo SemVer:
   - **patch** (`X.Y.Z+1`) — apenas bug fixes, sem mudança de comportamento observável além da correção
   - **minor** (`X.Y+1.0`) — features novas, novos comandos CLI, mudanças de UI não-breaking, expansão de API
   - **major** (`X+1.0.0`) — breaking changes (renomeação de comando, remoção de flag, mudança de schema de env/config, mudança incompatível de API)
2. **Atualização do `CHANGELOG.md`** feita por mim antes de fechar a tarefa — seção nova no topo (`## [X.Y.Z] — YYYY-MM-DD`) com `### Added` / `### Changed` / `### Fixed` / `### Removed` apropriados, bullets descritivos por mudança, e atualização dos links no rodapé. Se eu não fiz isso ainda, fazer antes de devolver o bloco.
3. **Bloco de comandos git** pronto pra copiar/colar, com placeholders claros quando necessário. Padrão:

   ```sh
   cd /media/kzezel/data/dados/development/aws/projetos/open_source/pulse
   git status
   git diff                       # revisar antes
   git add <paths específicos>    # nunca `git add -A`
   git commit -m "<tipo>(<escopo>): <resumo>"
   git tag -a v<X.Y.Z> -m "Pulse v<X.Y.Z> — <resumo>"
   git push origin main
   git push origin v<X.Y.Z>       # dispara o workflow `.github/workflows/release.yml`
   ```

4. **Nota curta de monitoramento**: lembrar que `gh run list --workflow=release.yml --limit 3` e `gh release view v<X.Y.Z>` validam que o workflow publicou os 4 assets (`pulse-v<X.Y.Z>.tar.gz`, `SHA256SUMS`, `install.sh`, `install.ps1`).

Regras:

- **Nunca rodar os comandos git**. O dono do repo pediu que Git fica manual (ver CLAUDE.md global). Só devolver o bloco.
- **Data real**: usar a data corrente no formato `YYYY-MM-DD` na entrada do CHANGELOG.
- **Mensagem de commit**: seguir o estilo `tipo(escopo): resumo` (ex: `fix(client): tmux attach needs TERM under systemd`, `feat(cli): add pulse config password/ports/paths/open`). Resumo em pt ou en, consistente com commits anteriores do repo.
- **Agrupar mudanças** relacionadas na mesma release. Se o usuário pediu várias coisas em sequência e nenhuma saiu ainda, uma release única bump-ando o tipo mais "forte" (fix+feature = minor, feature+breaking = major).
- **Não sugerir patch release** se a mudança adicionou comando CLI, entrada de env var, ou qualquer coisa que um usuário possa passar a depender. Patches são só pra correção.
- Se não tiver certeza do tipo de bump, **perguntar** antes de fechar — mas isso é exceção, não padrão.
