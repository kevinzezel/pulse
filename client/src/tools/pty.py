import asyncio
import fcntl
import logging
import os
import pty
import signal
import struct
import subprocess
import termios
import threading

logger = logging.getLogger(__name__)

# Hard cap por sessão. ~512 KB cobre 5000+ linhas densas mesmo com escape
# sequences pesadas (cores, cursor positioning). Trim de cabeça quando passa.
SCROLLBACK_BYTES = 512 * 1024

# Bound do listener queue do WS. O reader permanente popula scrollback (fonte
# da verdade) E enfileira no listener para o WS ativo. Em overflow (terminal
# vomitando + WS lento), drop oldest — o frontend já recebeu replay completo
# do scrollback no attach, então perda na fila não é perda de bytes.
LISTENER_QUEUE_MAX = 256

DEFAULT_SHELL_FALLBACK = "/bin/bash"


class PTYSession:
    """Shell session bound to a PTY.

    Owns the slave-side process and the master fd, plus a bounded scrollback
    buffer (bytearray, capped at SCROLLBACK_BYTES with newline-aligned trim)
    for byte-perfect replay on WebSocket (re)connect. Lives as long as the
    client process; survives WS disconnect/reconnect but not a client restart.

    Drena o master_fd continuamente via asyncio reader (registrado em start()),
    independente de WS conectado. Sem isso, ninguém lê do master quando o WS
    cai → kernel buffer enche → write() do shell bloqueia → processo
    efetivamente pausa até a reconexão. Com o reader permanente, o scrollback
    está sempre fresco e o agente continua executando enquanto o cliente está
    fora.
    """

    def __init__(self, session_id, cols=80, rows=24, start_directory=None):
        self.id = session_id
        self.cols = cols
        self.rows = rows
        self.cwd_at_start = start_directory
        self.process = None
        self.master_fd = None
        self.scrollback = bytearray()
        self.lock = threading.Lock()
        self._closed = False
        # Reader permanente + listener único (1 WS por sessão, enforced em
        # _active_ws). Tudo abaixo é tocado apenas no event loop principal,
        # então não precisa de lock.
        self._loop = None
        self._reader_installed = False
        self._eof_seen = False
        self._listener_queue = None

    def start(self):
        master_fd, slave_fd = pty.openpty()
        self._set_pty_size_fd(slave_fd, self.rows, self.cols)
        env = os.environ.copy()
        env.setdefault("TERM", "xterm-256color")
        shell = os.environ.get("SHELL") or DEFAULT_SHELL_FALLBACK
        cwd = None
        if (self.cwd_at_start
                and isinstance(self.cwd_at_start, str)
                and os.path.isabs(self.cwd_at_start)
                and os.path.isdir(self.cwd_at_start)):
            cwd = self.cwd_at_start
        self.process = subprocess.Popen(
            [shell, "-l"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=os.setsid,
            env=env,
            cwd=cwd,
            close_fds=True,
        )
        os.close(slave_fd)
        self.master_fd = master_fd
        # Captura o loop running e instala o reader permanente. Todas as paths
        # de criação atuais (create_session_request, restore_sessions_request,
        # clone_session_request) são async handlers, então get_running_loop()
        # sempre retorna o loop do uvicorn. Se um dia for chamado fora de
        # contexto async, _loop fica None e o reader não é instalado — write()
        # do shell vai bloquear como antes; deixa explícito no log.
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None
            logger.warning(
                "PTY session %s started without running loop — reader will not drain master_fd",
                self.id,
            )
        if self._loop is not None:
            self._loop.add_reader(self.master_fd, self._on_pty_read)
            self._reader_installed = True
        logger.info(
            "PTY session started: %s (pid=%s, fd=%s, cwd=%s)",
            self.id, self.process.pid, self.master_fd, cwd or "(inherit)",
        )
        return master_fd

    def _on_pty_read(self):
        """Callback do asyncio.add_reader. Roda no event loop principal.

        Drena master_fd → scrollback (fonte da verdade) + listener queue (WS
        ativo, opcional). Em EOF, remove o reader e sinaliza o listener com
        sentinela None.
        """
        try:
            data = os.read(self.master_fd, 65536)
        except OSError:
            data = b""
        if not data:
            self._handle_eof()
            return
        self.append_to_scrollback(data)
        q = self._listener_queue
        if q is None:
            return
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            # Drop oldest, push new. O scrollback está íntegro; o WS pode
            # resyncar via get_scrollback_bytes() no próximo replay.
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                pass

    def _handle_eof(self):
        """Idempotente. Remove reader e sinaliza EOF para o listener ativo."""
        if self._eof_seen:
            return
        self._eof_seen = True
        if self._loop is not None and self._reader_installed:
            try:
                self._loop.remove_reader(self.master_fd)
            except Exception:
                pass
            self._reader_installed = False
        q = self._listener_queue
        if q is None:
            return
        try:
            q.put_nowait(None)
        except asyncio.QueueFull:
            # Listener vai detectar EOF via WebSocketDisconnect ou pelo reaper
            # de qualquer forma.
            pass

    def attach_listener(self, queue):
        """Registra a queue do WS ativo. Sobrescreve listener anterior se
        existir (1 WS por sessão; o anterior já foi fechado em _active_ws).
        Chamado no event loop, sem lock necessário.

        Se EOF já foi observado antes do attach, sinaliza imediatamente para
        o WS fechar com 1000 (Session ended) sem precisar esperar o reaper.
        """
        self._listener_queue = queue
        if self._eof_seen:
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                pass

    def detach_listener(self, queue):
        """Limpa o listener se for o que está registrado. Chamado no event
        loop, sem lock."""
        if self._listener_queue is queue:
            self._listener_queue = None

    def append_to_scrollback(self, data):
        with self.lock:
            self.scrollback.extend(data)
            overflow = len(self.scrollback) - SCROLLBACK_BYTES
            if overflow <= 0:
                return
            # Corta o excesso exato e depois empurra o início pro próximo
            # boundary "seguro" (newline ou começo de ESC) dentro de uma
            # janela curta. Sem isso, o replay no WS começaria no meio de
            # uma escape sequence: o `[31m` órfão vira "[31m" literal no
            # xterm.js e pyte pode confundir um OSC partial com terminator
            # BEL/ST "comendo" linhas legítimas. Margem extra: até 256B
            # acima do hard cap nominal.
            del self.scrollback[:overflow]
            TRIM_SCAN_BYTES = 256
            scan = min(len(self.scrollback), TRIM_SCAN_BYTES)
            extra = 0
            for i in range(scan):
                b = self.scrollback[i]
                if b == 0x0A:  # \n
                    extra = i + 1
                    break
                if b == 0x1B:  # \x1b (ESC inicia uma nova sequência)
                    extra = i
                    break
            if extra > 0:
                del self.scrollback[:extra]

    def get_scrollback_bytes(self):
        with self.lock:
            return bytes(self.scrollback)

    def write(self, data):
        if self.master_fd is None:
            return 0
        return os.write(self.master_fd, data)

    def resize(self, rows, cols):
        self.rows = rows
        self.cols = cols
        if self.master_fd is None:
            return
        self._set_pty_size_fd(self.master_fd, rows, cols)
        # SIGWINCH ao process group inteiro (shell + filhos como vim/htop/Claude
        # Code) — process_group foi criado via os.setsid no preexec_fn.
        if self.process is not None:
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGWINCH)
            except (ProcessLookupError, OSError):
                pass

    def get_cwd(self):
        # Foreground job: tcgetpgrp devolve o PID líder do grupo em foco no
        # PTY (ex: vim/Claude Code rodando dentro do shell). É o cwd que o
        # usuário espera ver no "Open editor". Cai pro PID do shell quando
        # nada mais está em foreground.
        if self.process is None:
            return None
        target_pid = None
        if self.master_fd is not None:
            try:
                fg = os.tcgetpgrp(self.master_fd)
                if fg > 0:
                    target_pid = fg
            except OSError:
                pass
        if target_pid is None:
            target_pid = self.process.pid
        try:
            return os.readlink(f"/proc/{target_pid}/cwd")
        except (OSError, ProcessLookupError):
            return None

    def is_alive(self):
        return self.process is not None and self.process.poll() is None

    def kill(self):
        if self.process is None:
            return
        if self.process.poll() is not None:
            return
        # SIGHUP semantica "terminal foi embora" — pega o pgroup todo, então
        # filhos (vim, agentes, etc) também recebem.
        try:
            os.killpg(os.getpgid(self.process.pid), signal.SIGHUP)
        except (ProcessLookupError, OSError):
            pass

    def close(self):
        if self._closed:
            return
        self._closed = True
        # ORDEM IMPORTA: remove_reader ANTES de os.close. Inverter arrisca o
        # callback do reader disparar em fd já fechado, levando ao EBADF e
        # potencialmente a estado inconsistente do selector.
        if self._loop is not None and self._reader_installed and self.master_fd is not None:
            try:
                self._loop.remove_reader(self.master_fd)
            except Exception:
                pass
            self._reader_installed = False
        self.kill()
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
        # Colher o zumbi imediatamente em vez de esperar reap_dead_ptys ou
        # GC do Popen — sob churn alto (kill 1000 sessões em sequência) o
        # acúmulo bate em RLIMIT_NPROC. Wait curto: SIGHUP costuma matar em
        # <50ms; se não morreu nessa janela, deixa pro reaper/GC.
        if self.process is not None:
            try:
                self.process.wait(timeout=0.1)
            except subprocess.TimeoutExpired:
                pass
            except Exception:
                pass

    @staticmethod
    def _set_pty_size_fd(fd, rows, cols):
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


_pty_by_session = {}
_registry_lock = threading.Lock()


def get_pty(session_id):
    with _registry_lock:
        return _pty_by_session.get(session_id)


def register_pty(session_id, pty_session):
    with _registry_lock:
        _pty_by_session[session_id] = pty_session


def unregister_pty(session_id):
    with _registry_lock:
        return _pty_by_session.pop(session_id, None)


def list_pty_ids():
    with _registry_lock:
        return list(_pty_by_session.keys())
