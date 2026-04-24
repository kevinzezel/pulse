import os

from system.log import AppException

# Cap de itens por listagem. Constante no módulo. Sem override por env.
FS_LIST_MAX_ENTRIES = 1000


def list_directory_request(path):
    # 1. Resolve target. Sem path -> $HOME do user do client.
    if path is None or not str(path).strip():
        target = os.path.expanduser("~")
    else:
        target = path
        # Reject obvious garbage early — null bytes break os.* calls in
        # surprising ways and there is no legitimate use case.
        if "\x00" in target:
            raise AppException(key="errors.fs_path_invalid", status_code=400)
        if not os.path.isabs(target):
            raise AppException(key="errors.fs_path_invalid", status_code=400)

    # 2. Canonicalize. realpath resolves symlinks and normalizes ../, so any
    # attempt to escape via "../../etc" lands on the actual path the user
    # would land on if they typed it. Not sandboxing — keeps the response
    # self-consistent (the path returned matches what the user gets if they
    # cd into it later). Without strict=True it does not raise on
    # non-existent paths; the existence check below catches that with a
    # clearer error key.
    canonical = os.path.realpath(target)

    # 3. Validate.
    if not os.path.exists(canonical):
        raise AppException(key="errors.fs_path_not_found", status_code=404)
    if not os.path.isdir(canonical):
        raise AppException(key="errors.fs_path_not_directory", status_code=400)

    # 4. Iterate with cap. follow_symlinks=True is the right call here — users
    # expect symlinks to project dirs to behave like the dir itself. No
    # recursion happens (scandir is one level), so loops are not a risk.
    entries = []
    truncated = False
    try:
        with os.scandir(canonical) as it:
            for entry in it:
                try:
                    if entry.is_dir(follow_symlinks=True):
                        entries.append({"name": entry.name})
                        if len(entries) >= FS_LIST_MAX_ENTRIES:
                            truncated = True
                            break
                except OSError:
                    # Broken symlink, race with rm, etc. — skip silently.
                    continue
    except PermissionError:
        raise AppException(key="errors.fs_path_denied", status_code=403)
    except OSError:
        raise AppException(key="errors.fs_path_not_found", status_code=404)

    # 5. Sort case-insensitive alphabetical.
    entries.sort(key=lambda e: e["name"].lower())

    # 6. Compute parent ("/" has no parent).
    parent = None if canonical == "/" else os.path.dirname(canonical)

    return {
        "status_code": 200,
        "content": {
            "detail_key": "status.ok",
            "path": canonical,
            "parent": parent,
            "entries": entries,
            "truncated": truncated,
        },
    }
