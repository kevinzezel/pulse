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


from routes import terminal, settings as settings_route, version as version_route
from resources.terminal import recover_sessions
from resources.settings import load_settings
from resources.notifications import notification_watcher

_auth = [Depends(require_api_key)]

app.include_router(terminal.router, prefix="/api", tags=["Terminal"], dependencies=_auth)
app.include_router(terminal.ws_router, tags=["WebSocket"])
app.include_router(settings_route.router, prefix="/api", tags=["Settings"], dependencies=_auth)
app.include_router(version_route.router, prefix="/api", tags=["Version"], dependencies=_auth)

load_settings()
recover_sessions()


@app.on_event("startup")
async def _start_background_tasks():
    asyncio.create_task(notification_watcher())
