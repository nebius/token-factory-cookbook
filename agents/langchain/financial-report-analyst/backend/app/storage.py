from __future__ import annotations

import re
import shutil
from pathlib import Path

from fastapi import UploadFile

from app.config import settings

SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name: str) -> str:
    cleaned = SAFE_NAME.sub("-", Path(name).name).strip(".-")
    return cleaned or "document"


def project_dir(project_id: str) -> Path:
    path = settings.storage_root / "projects" / project_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def document_dir(project_id: str, document_id: str) -> Path:
    path = project_dir(project_id) / "documents" / document_id
    (path / "pages").mkdir(parents=True, exist_ok=True)
    (path / "visuals").mkdir(parents=True, exist_ok=True)
    return path


async def save_upload(project_id: str, document_id: str, upload: UploadFile) -> Path:
    target = document_dir(project_id, document_id) / "original" / safe_filename(upload.filename or "upload.bin")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as out:
        while chunk := await upload.read(1024 * 1024):
            out.write(chunk)
    await upload.close()
    return target


def artifact_url(path: str) -> str | None:
    if not path:
        return None
    try:
        relative = Path(path).resolve().relative_to(settings.storage_root)
    except ValueError:
        return None
    return f"/api/artifacts/{relative.as_posix()}"


def resolve_artifact(relative_path: str) -> Path:
    resolved = (settings.storage_root / relative_path).resolve()
    resolved.relative_to(settings.storage_root)
    return resolved


def copy_to_artifact(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
