from fastapi import APIRouter, Request

from resources.fs import list_directory_request
from system.i18n import build_i18n_response

router = APIRouter()


@router.get("/fs/list")
def list_directory(request: Request, path: str | None = None):
    resp = list_directory_request(path)
    return build_i18n_response(request, resp["status_code"], resp["content"])
