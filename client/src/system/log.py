import logging
import colorlog


class AppException(Exception):
    def __init__(self, key: str, status_code: int = 400, params: dict | None = None, **extras):
        self.key = key
        self.params = params or {}
        self.status_code = status_code
        self.extras = extras


def setup_logging():
    color_log_format = colorlog.ColoredFormatter(
        "%(log_color)s%(asctime)s [UTC] - %(levelname)s - %(message)s",
        datefmt='%Y-%m-%d %H:%M:%S',
        reset=True,
        log_colors={
            'DEBUG': 'cyan',
            'INFO': 'green',
            'WARNING': 'yellow',
            'ERROR': 'red',
            'CRITICAL': 'bold_red',
        }
    )

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(color_log_format)

    logging.basicConfig(
        level=logging.INFO,
        handlers=[console_handler]
    )

    return logging.getLogger()
