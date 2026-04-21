import hmac

from fastapi import Header

from envs.load import API_KEY
from system.log import AppException


async def require_api_key(x_api_key: str | None = Header(default=None)):
    if not x_api_key or not hmac.compare_digest(x_api_key, API_KEY):
        raise AppException(key="errors.unauthorized", status_code=401)
