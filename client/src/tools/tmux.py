import subprocess
import pty
import os
import struct
import fcntl
import termios
import logging

logger = logging.getLogger(__name__)


def ensure_tmux_config():
    # Apply Pulse's server-wide tmux options. Silently becomes a no-op if no
    # tmux server is running (set-option -ga without a server prints
    # "no server running on …" and exits 1). That's fine because
    # create_session() also calls this right after `tmux new-session`, which
    # is the first reliable moment to write to the server — at client
    # startup there may be no server yet, but as soon as a session is
    # created (or recovered) the server is up.
    #
    #   smcup@ / rmcup@ — tmux doesn't put outer terminal in alt-screen on
    #                     attach. Mouse wheel scrolls xterm.js scrollback
    #                     natively instead of being translated to ↑/↓ arrow
    #                     keys (which would navigate shell history).
    #   E3@            — tmux doesn't forward the terminfo "clear scrollback"
    #                     entry (ESC [ 3 J / ED3) to outer. Claude Code's
    #                     startup fires this via tmux and otherwise wipes
    #                     xterm.js's scrollback down to exactly rows of
    #                     viewport height. See anthropics/claude-code#16310.
    #
    # -ga = global + append, so any user overrides in ~/.tmux.conf survive.
    try:
        subprocess.run(
            ['tmux', 'set-option', '-ga', 'terminal-overrides', ',*:smcup@:rmcup@:E3@'],
            capture_output=True, check=False,
        )
    except FileNotFoundError:
        logger.warning("tmux not found while applying Pulse tmux config")


def create_session(session_id, cols=80, rows=24, start_directory=None):
    cmd = ['tmux', 'new-session', '-d', '-s', session_id, '-x', str(cols), '-y', str(rows)]
    if start_directory and os.path.isabs(start_directory) and os.path.isdir(start_directory):
        cmd.extend(['-c', start_directory])
    subprocess.run(cmd, check=True)
    # Now that we've just guaranteed a tmux server exists, persist our
    # terminal-overrides. On cold starts this is the first time the set-option
    # call has a server to write to — the recover_sessions() call at client
    # startup silently fails if there's no server yet.
    ensure_tmux_config()
    subprocess.run(
        ['tmux', 'set-option', '-t', session_id, 'status', 'off'],
        check=True
    )
    logger.info(f"tmux session created: {session_id}")


def attach_session(session_id):
    master_fd, slave_fd = pty.openpty()
    # tmux attach-session refuses to run without TERM (exits immediately with
    # "open terminal failed: missing or unsuitable terminal"). When the client
    # runs under systemd/launchd the parent process inherits no TERM, so we
    # inject a sane default before spawning.
    env = os.environ.copy()
    env.setdefault('TERM', 'xterm-256color')
    process = subprocess.Popen(
        ['tmux', 'attach-session', '-t', session_id],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        preexec_fn=os.setsid,
        env=env,
    )
    os.close(slave_fd)
    logger.info(f"Attached to tmux session: {session_id} (pid={process.pid}, fd={master_fd})")
    return process, master_fd


def kill_session(session_id):
    subprocess.run(['tmux', 'kill-session', '-t', session_id], check=True)
    logger.info(f"tmux session killed: {session_id}")


def list_sessions():
    try:
        result = subprocess.run(
            ['tmux', 'list-sessions', '-F', '#{session_name}:#{session_created}'],
            capture_output=True, text=True
        )
    except FileNotFoundError:
        logger.warning("tmux not found in PATH")
        return []
    if result.returncode != 0:
        return []

    sessions = []
    for line in result.stdout.strip().split('\n'):
        if not line:
            continue
        parts = line.split(':', 1)
        sessions.append({
            "id": parts[0],
            "created_ts": parts[1] if len(parts) > 1 else ""
        })
    return sessions


def set_pty_size(fd, rows, cols):
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def session_exists(session_id):
    try:
        result = subprocess.run(
            ['tmux', 'has-session', '-t', session_id],
            capture_output=True
        )
    except FileNotFoundError:
        return False
    return result.returncode == 0


def set_custom_name(session_id, name):
    subprocess.run(
        ['tmux', 'set-option', '-t', session_id, '@custom_name', name],
        capture_output=True
    )


def get_custom_name(session_id):
    try:
        result = subprocess.run(
            ['tmux', 'show-option', '-t', session_id, '-v', '@custom_name'],
            capture_output=True, text=True
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def set_group_id(session_id, group_id):
    if group_id:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '@group_id', group_id],
            capture_output=True
        )
    else:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '-u', '@group_id'],
            capture_output=True
        )


def get_group_id(session_id):
    try:
        result = subprocess.run(
            ['tmux', 'show-option', '-t', session_id, '-v', '@group_id'],
            capture_output=True, text=True
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def set_project_id(session_id, project_id):
    if project_id:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '@project_id', project_id],
            capture_output=True
        )
    else:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '-u', '@project_id'],
            capture_output=True
        )


def get_project_id(session_id):
    try:
        result = subprocess.run(
            ['tmux', 'show-option', '-t', session_id, '-v', '@project_id'],
            capture_output=True, text=True
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def set_project_name(session_id, name):
    if name:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '@project_name', name],
            capture_output=True
        )
    else:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '-u', '@project_name'],
            capture_output=True
        )


def get_project_name(session_id):
    try:
        result = subprocess.run(
            ['tmux', 'show-option', '-t', session_id, '-v', '@project_name'],
            capture_output=True, text=True
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def set_group_name(session_id, name):
    if name:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '@group_name', name],
            capture_output=True
        )
    else:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '-u', '@group_name'],
            capture_output=True
        )


def get_group_name(session_id):
    try:
        result = subprocess.run(
            ['tmux', 'show-option', '-t', session_id, '-v', '@group_name'],
            capture_output=True, text=True
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def capture_pane(session_id, lines=100):
    try:
        result = subprocess.run(
            ['tmux', 'capture-pane', '-p', '-t', session_id, '-S', f'-{lines}'],
            capture_output=True, text=True, timeout=3.0,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def set_notify_on_idle(session_id, value):
    if value:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '@notify_on_idle', '1'],
            capture_output=True,
        )
    else:
        subprocess.run(
            ['tmux', 'set-option', '-t', session_id, '-u', '@notify_on_idle'],
            capture_output=True,
        )


def get_notify_on_idle(session_id):
    try:
        result = subprocess.run(
            ['tmux', 'show-option', '-t', session_id, '-v', '@notify_on_idle'],
            capture_output=True, text=True,
        )
    except FileNotFoundError:
        return False
    if result.returncode != 0:
        return False
    return result.stdout.strip() == '1'


def send_text_to_session(session_id, text, send_enter=False):
    if text:
        subprocess.run(
            ['tmux', 'send-keys', '-l', '-t', session_id, text],
            capture_output=True,
        )
    if send_enter:
        subprocess.run(
            ['tmux', 'send-keys', '-t', session_id, 'Enter'],
            capture_output=True,
        )


def get_pane_cwd(session_id):
    try:
        result = subprocess.run(
            ['tmux', 'display-message', '-p', '-t', session_id, '#{pane_current_path}'],
            capture_output=True, text=True
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None
