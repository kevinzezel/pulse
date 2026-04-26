from system.log import setup_logging, AppException
setup_logging()

import asyncio
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from envs.load import COMPOSE_PROJECT_NAME, VERSION
from system.i18n import translate, parse_accept_language
from system.auth import require_api_key

import logging
logger = logging.getLogger()

app = FastAPI(
    title="Pulse",
    description="Keep your terminals alive",
    version=VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    locale = parse_accept_language(request.headers.get("accept-language"))
    detail = translate(exc.key, locale, **exc.params)
    content = {
        "detail": detail,
        "detail_key": exc.key,
        "detail_params": exc.params,
        **exc.extras,
    }
    return JSONResponse(status_code=exc.status_code, content=content)


@app.get("/health", tags=["Health"])
def health():
    return JSONResponse(status_code=200, content={"status": "UP"})


from routes import terminal, settings as settings_route, version as version_route, fs as fs_route
from resources.terminal import close_active_websockets_for_shutdown, recover_sessions, reap_dead_ptys
from resources.settings import load_settings
from resources.notifications import notification_watcher
from tools.pty import set_main_loop

_auth = [Depends(require_api_key)]

app.include_router(terminal.router, prefix="/api", tags=["Terminal"], dependencies=_auth)
app.include_router(terminal.ws_router, tags=["WebSocket"])
app.include_router(settings_route.router, prefix="/api", tags=["Settings"], dependencies=_auth)
app.include_router(version_route.router, prefix="/api", tags=["Version"], dependencies=_auth)
app.include_router(fs_route.router, prefix="/api", tags=["FS"], dependencies=_auth)

load_settings()


@app.on_event("startup")
async def _start_background_tasks():
    # Captura o loop principal para PTYSession.start()/close() chamarem
    # add_reader/remove_reader via call_soon_threadsafe. Endpoints `def`
    # (sync) rodam em thread pool, sem running loop visível — sem isso o
    # reader permanente nunca seria instalado e o WS ficaria sem output.
    set_main_loop(asyncio.get_running_loop())
    # recover_sessions() é no-op em PTY mode (não há persistência server-side
    # do estado do shell), mas roda dentro do startup async para que, se um
    # dia voltar a criar PTYs no recovery, tenha o loop principal já
    # registrado.
    recover_sessions()
    asyncio.create_task(notification_watcher())
    asyncio.create_task(reap_dead_ptys())


@app.on_event("shutdown")
async def _close_terminal_websockets():
    await close_active_websockets_for_shutdown()
