"""Chat images in the retained input assets directory, with server-owned filenames."""
import filecmp
import json
import os
from pathlib import Path
import re
import threading
import uuid

from . import media, schema

FOLDER = 'freevideo/agent/assets'
_LOCK = threading.RLock()


def path(input_root, name):
    if not isinstance(name, str) or not re.fullmatch(schema.CHAT_ATTACHMENT_NAME['pattern'], name):
        raise ValueError('Invalid attachment name')
    root = Path(input_root).resolve()
    target = root / FOLDER / name
    # Reject links, including links to another location inside the input directory.
    for part in (target, *target.parents):
        if part == root:
            break
        if part.is_symlink():
            raise ValueError('Attachment paths cannot contain links')
    if target.resolve() != target:
        raise ValueError('Attachment leaves assets')
    return target


def _metadata(target):
    result = target.with_name('.' + target.name + '.json')
    if result.is_symlink():
        raise ValueError('Invalid attachment metadata')
    return result


def publish(input_root, temporary, name, original_name):
    """Publish decoded bytes atomically; the first filename for identical content wins."""
    with _LOCK:
        target = path(input_root, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        metadata = _metadata(target)
        if not metadata.exists():
            pending = metadata.with_name('.attachment-' + uuid.uuid4().hex + '.tmp')
            try:
                pending.write_text(json.dumps(dict(original_name=original_name), ensure_ascii=False), encoding='utf-8')
                os.replace(pending, metadata)
            finally:
                pending.unlink(missing_ok=True)
        # Identical bytes are already in place; replacing a file the page is reading fails on Windows.
        if target.is_file() and filecmp.cmp(temporary, target, shallow=False):
            Path(temporary).unlink(missing_ok=True)
        else:
            os.replace(temporary, target)
        return json.loads(metadata.read_text(encoding='utf-8'))['original_name']


def read(input_root, name):
    """Reinspect stored bytes; never use dimensions or filenames sent with a message."""
    with _LOCK:
        target = path(input_root, name)
        if not target.is_file() or target.stat().st_size > schema.MAX_CHAT_ATTACHMENT_BYTES:
            raise ValueError('No saved attachment within the upload limit')
        info, suffix = media.validate_upload(target)
        if suffix not in ('.png', '.jpg', '.webp') or info['kind'] != 'image':
            raise ValueError('Not a chat image')
        metadata = _metadata(target)
        original_name = json.loads(metadata.read_text(encoding='utf-8'))['original_name'] if metadata.exists() else name
        return dict(name=name, original_name=original_name, width=info['width'], height=info['height'])
