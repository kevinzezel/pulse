import subprocess
import pty
import os
import struct
import fcntl
import termios
import logging

logger = logging.getLogger(__name__)


def create_session(session_id, cols=80, rows=24, start_directory=None):
    cmd = ['tmux', 'new-session', '-d', '-s', session_id, '-x', str(cols), '-y', str(rows)]
    if start_directory and os.path.isabs(start_directory) and os.path.isdir(start_directory):
        cmd.extend(['-c', start_directory])
    subprocess.run(cmd, check=True)
    subprocess.run(
        ['tmux', 'set-option', '-t', session_id, 'status', 'off'],
        check=True
    )
    logger.info(f"tmux session created: {session_id}")


def attach_session(session_id):
    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(
        ['tmux', 'attach-session', '-t', session_id],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        preexec_fn=os.setsid
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


def capture_pane(session_id, lines=100):
    try:
        result = subprocess.run(
            ['tmux', 'capture-pane', '-p', '-t', session_id, '-S', f'-{lines}'],
            capture_output=True, text=True,
        )
    except FileNotFoundError:
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
