from fastapi import APIRouter, Request

from envs.load import VERSION
from system.i18n import build_i18n_response

router = APIRouter()


@router.get("/version")
def get_version(request: Request):
    return build_i18n_response(request, 200, {
        "detail_key": "status.ok",
        "version": VERSION,
    })
