CATALOGS = {
    "pt-BR": {
        "errors.unauthorized": "Não autorizado",
        "errors.image_too_large": "Imagem excede o limite de {max_mb} MB",
        "errors.session_not_found": "Sessão não encontrada",
        "errors.tmux_session_not_found": "Sessão tmux não encontrada",
        "errors.empty_name": "Nome não pode ser vazio",
        "errors.cwd_unavailable": "Não foi possível obter o diretório atual",
        "errors.editor_binary_not_found": "Binário do editor não encontrado no host. Instale VSCode / Cursor / VSCodium, ou defina o caminho em Configurações → Editor.",
        "errors.editor_binary_not_executable": "Caminho não é executável: {path}",
        "success.session_created": "Sessão criada",
        "success.session_closed": "Sessão encerrada",
        "success.session_renamed": "Sessão renomeada",
        "success.session_cloned": "Sessão clonada",
        "success.editor_opened": "Editor aberto",
        "success.image_saved": "Imagem salva",
        "success.text_sent": "Texto enviado para o terminal",
        "success.session_group_assigned": "Sessão movida de grupo",
        "success.settings_updated": "Configurações atualizadas",
        "success.telegram_test_sent": "Mensagem de teste enviada",
        "success.session_notify_updated": "Notificação da sessão atualizada",
        "errors.telegram_not_configured": "Telegram não configurado",
        "errors.telegram_send_failed": "Falha ao enviar pelo Telegram: {detail}",
        "errors.invalid_timeout": "Timeout deve estar entre {min} e {max} segundos",
        "errors.no_chat_found": "Nenhum chat encontrado. Envie uma mensagem ao bot e tente de novo.",
        "success.chat_id_discovered": "Chat ID detectado",
        "success.sessions_restored": "{count} sessão(ões) restaurada(s)",
        "errors.fs_path_invalid": "Caminho inválido",
        "errors.fs_path_not_found": "Caminho não encontrado",
        "errors.fs_path_denied": "Permissão negada para listar o diretório",
        "errors.fs_path_not_directory": "O caminho não é um diretório",
        "status.ok": "OK",
        "status.sync_result": "Sincronização: {added} adicionadas, {removed} removidas",
    },
    "en": {
        "errors.unauthorized": "Unauthorized",
        "errors.image_too_large": "Image exceeds {max_mb} MB limit",
        "errors.session_not_found": "Session not found",
        "errors.tmux_session_not_found": "tmux session not found",
        "errors.empty_name": "Name cannot be empty",
        "errors.cwd_unavailable": "Could not get current directory",
        "errors.editor_binary_not_found": "Editor binary not found on the host. Install VSCode / Cursor / VSCodium, or set the path in Settings → Editor.",
        "errors.editor_binary_not_executable": "Path is not executable: {path}",
        "success.session_created": "Session created",
        "success.session_closed": "Session closed",
        "success.session_renamed": "Session renamed",
        "success.session_cloned": "Session cloned",
        "success.editor_opened": "Editor opened",
        "success.image_saved": "Image saved",
        "success.text_sent": "Text sent to terminal",
        "success.session_group_assigned": "Session moved to group",
        "success.settings_updated": "Settings updated",
        "success.telegram_test_sent": "Test message sent",
        "success.session_notify_updated": "Session notification updated",
        "errors.telegram_not_configured": "Telegram is not configured",
        "errors.telegram_send_failed": "Failed to send via Telegram: {detail}",
        "errors.invalid_timeout": "Timeout must be between {min} and {max} seconds",
        "errors.no_chat_found": "No chat found. Send a message to the bot and try again.",
        "success.chat_id_discovered": "Chat ID detected",
        "success.sessions_restored": "{count} session(s) restored",
        "errors.fs_path_invalid": "Invalid path",
        "errors.fs_path_not_found": "Path not found",
        "errors.fs_path_denied": "Permission denied to list directory",
        "errors.fs_path_not_directory": "Path is not a directory",
        "status.ok": "OK",
        "status.sync_result": "Sync: {added} added, {removed} removed",
    },
    "es": {
        "errors.unauthorized": "No autorizado",
        "errors.image_too_large": "La imagen excede el límite de {max_mb} MB",
        "errors.session_not_found": "Sesión no encontrada",
        "errors.tmux_session_not_found": "Sesión tmux no encontrada",
        "errors.empty_name": "El nombre no puede estar vacío",
        "errors.cwd_unavailable": "No se pudo obtener el directorio actual",
        "errors.editor_binary_not_found": "Binario del editor no encontrado en el host. Instala VSCode / Cursor / VSCodium, o define la ruta en Ajustes → Editor.",
        "errors.editor_binary_not_executable": "La ruta no es ejecutable: {path}",
        "success.session_created": "Sesión creada",
        "success.session_closed": "Sesión cerrada",
        "success.session_renamed": "Sesión renombrada",
        "success.session_cloned": "Sesión clonada",
        "success.editor_opened": "Editor abierto",
        "success.image_saved": "Imagen guardada",
        "success.text_sent": "Texto enviado al terminal",
        "success.session_group_assigned": "Sesión movida de grupo",
        "success.settings_updated": "Configuración actualizada",
        "success.telegram_test_sent": "Mensaje de prueba enviado",
        "success.session_notify_updated": "Notificación de la sesión actualizada",
        "errors.telegram_not_configured": "Telegram no configurado",
        "errors.telegram_send_failed": "Error al enviar por Telegram: {detail}",
        "errors.invalid_timeout": "El timeout debe estar entre {min} y {max} segundos",
        "errors.no_chat_found": "No se encontró ningún chat. Envía un mensaje al bot e intenta de nuevo.",
        "success.chat_id_discovered": "Chat ID detectado",
        "success.sessions_restored": "{count} sesión(es) restaurada(s)",
        "errors.fs_path_invalid": "Ruta inválida",
        "errors.fs_path_not_found": "Ruta no encontrada",
        "errors.fs_path_denied": "Permiso denegado para listar el directorio",
        "errors.fs_path_not_directory": "La ruta no es un directorio",
        "status.ok": "OK",
        "status.sync_result": "Sincronización: {added} añadidas, {removed} eliminadas",
    },
}

DEFAULT_LOCALE = "en"
SUPPORTED_LOCALES = list(CATALOGS.keys())


def parse_accept_language(header: str | None) -> str:
    if not header:
        return DEFAULT_LOCALE

    candidates = []
    for part in header.split(","):
        piece = part.strip()
        if not piece:
            continue
        if ";q=" in piece:
            tag, q = piece.split(";q=", 1)
            try:
                quality = float(q)
            except ValueError:
                quality = 1.0
        else:
            tag, quality = piece, 1.0
        candidates.append((tag.strip().lower(), quality))

    candidates.sort(key=lambda x: x[1], reverse=True)

    for tag, _ in candidates:
        for locale in SUPPORTED_LOCALES:
            if tag == locale.lower():
                return locale
        primary = tag.split("-")[0]
        for locale in SUPPORTED_LOCALES:
            if primary == locale.split("-")[0].lower():
                return locale

    return DEFAULT_LOCALE


def translate(key: str, locale: str = DEFAULT_LOCALE, **params) -> str:
    catalog = CATALOGS.get(locale) or CATALOGS[DEFAULT_LOCALE]
    template = catalog.get(key) or CATALOGS[DEFAULT_LOCALE].get(key) or key
    if params:
        try:
            return template.format(**params)
        except (KeyError, IndexError):
            return template
    return template


def build_i18n_response(request, status_code: int, content: dict):
    from fastapi.responses import JSONResponse

    locale = parse_accept_language(request.headers.get("accept-language"))
    result = dict(content)
    key = result.get("detail_key")
    if key:
        params = result.get("detail_params", {})
        result["detail"] = translate(key, locale, **params)
    return JSONResponse(status_code=status_code, content=result)
