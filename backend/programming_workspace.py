from __future__ import annotations

import base64
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import HTTPException


WORKSPACE_ROOT = Path(__file__).resolve().parent / "data" / "programming-workspaces"
PROJECT_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")
MAX_FILES = 60
MAX_FILE_BYTES = 1_000_000
MAX_TOTAL_BYTES = 5_000_000
MAX_CONTEXT_FILES = 60
MAX_CONTEXT_SCAN_ENTRIES = 20_000
MAX_CONTEXT_FILE_BYTES = 200_000
MAX_CONTEXT_BYTES = 2_000_000
MAX_COMMAND_LENGTH = 2_000
MAX_OUTPUT_LENGTH = 20_000
COMMAND_TIMEOUT_SECONDS = 60
GITHUB_CLONE_TIMEOUT_SECONDS = 600
GIT_OPERATION_TIMEOUT_SECONDS = 30
GIT_PUSH_TIMEOUT_SECONDS = 120
MAX_CAPTURE_BYTES = 1_000_000
WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
IGNORED_WORKSPACE_PARTS = {
    ".git", ".idea", ".theia", ".vscode", "__pycache__", "build", "dist",
    "node_modules", "out", "target", ".venv", "venv",
}
SENSITIVE_WORKSPACE_NAMES = {".env", ".env.local", ".env.production", "id_rsa", "id_ed25519"}
GITHUB_FULL_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
GIT_AUTHOR_NAME_PATTERN = re.compile(r"^[^\x00-\x1f\x7f]{1,100}$")
GIT_AUTHOR_EMAIL_PATTERN = re.compile(r"^[^\s<>@\x00-\x1f\x7f]+@[^\s<>@\x00-\x1f\x7f]+$")


def _owner_directory(owner_id: str | None) -> Path:
    owner_key = hashlib.sha256((owner_id or "local").encode("utf-8")).hexdigest()
    return WORKSPACE_ROOT / owner_key


def _project_directory(owner_id: str | None, project_id: str) -> Path:
    if not PROJECT_ID_PATTERN.fullmatch(project_id):
        raise HTTPException(status_code=422, detail="Invalid programming project identifier.")
    if WORKSPACE_ROOT.is_symlink():
        raise HTTPException(status_code=400, detail="The programming workspace root is invalid.")
    workspace_root = WORKSPACE_ROOT.resolve()
    owner_directory = _owner_directory(owner_id)
    if owner_directory.is_symlink():
        raise HTTPException(status_code=400, detail="The programming workspace path is invalid.")
    owner_directory = owner_directory.resolve()
    if not owner_directory.is_relative_to(workspace_root):
        raise HTTPException(status_code=400, detail="The programming workspace path is outside its root.")
    project_directory = owner_directory / project_id
    if project_directory.is_symlink():
        raise HTTPException(status_code=400, detail="The programming project path is invalid.")
    return project_directory


def _write_project_files(project_directory: Path, files: list[dict[str, str]]) -> None:
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=413, detail=f"A project may contain at most {MAX_FILES} files per request.")

    total_bytes = 0
    project_root = project_directory.resolve()
    for item in files:
        relative = item["path"]
        path = Path(relative)
        invalid_windows_part = any(
            part.endswith((".", " "))
            or any(character in '<>:"|?*' or ord(character) < 32 for character in part)
            or part.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES
            for part in path.parts
        )
        if (
            not relative.strip()
            or "\\" in relative
            or path.is_absolute()
            or any(part in {"", ".", ".."} for part in path.parts)
            or (path.parts and ":" in path.parts[0])
            or invalid_windows_part
        ):
            raise HTTPException(status_code=422, detail="Project file paths must stay inside the project directory.")

        content = item["content"]
        size = len(content.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"File '{relative}' exceeds the 1 MB limit.")
        total_bytes += size
        if total_bytes > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Project files exceed the 5 MB request limit.")

        target = project_directory.joinpath(*path.parts)
        current = project_directory
        for part in path.parts[:-1]:
            current = current / part
            if current.is_symlink():
                raise HTTPException(status_code=400, detail="Project files cannot write through symbolic links.")
            current.mkdir(exist_ok=True)
        if target.is_symlink() or not target.resolve().is_relative_to(project_root):
            raise HTTPException(status_code=400, detail="Project files cannot write outside the project directory.")
        if target.is_dir():
            raise HTTPException(status_code=422, detail=f"Project file path '{relative}' is a directory.")
        target.write_text(content, encoding="utf-8")


def initialize_project_workspace(
    owner_id: str | None,
    project_id: str,
    files: list[dict[str, str]],
) -> dict[str, str | list[dict[str, str]] | bool]:
    project_directory = _project_directory(owner_id, project_id)
    if project_directory.exists() and not project_directory.is_dir():
        raise HTTPException(status_code=400, detail="The programming project path is not a directory.")
    if not project_directory.exists():
        project_directory.mkdir(parents=True, exist_ok=True)
        _write_project_files(project_directory, files)
    return {
        "working_directory": str(project_directory),
        **read_project_workspace(owner_id, project_id),
    }


def write_project_workspace(
    owner_id: str | None,
    project_id: str,
    files: list[dict[str, str]],
) -> dict[str, str]:
    project_directory = _project_directory(owner_id, project_id)
    if project_directory.exists() and not project_directory.is_dir():
        raise HTTPException(status_code=400, detail="The programming project path is not a directory.")
    project_directory.mkdir(parents=True, exist_ok=True)
    _write_project_files(project_directory, files)
    return {"working_directory": str(project_directory)}


def clone_github_repository_workspace(
    owner_id: str | None,
    project_id: str,
    repository_full_name: str,
    access_token: str,
) -> dict[str, str]:
    if not GITHUB_FULL_NAME_PATTERN.fullmatch(repository_full_name):
        raise HTTPException(status_code=422, detail="Invalid GitHub repository name.")
    if any(part in {"", ".", ".."} for part in repository_full_name.split("/")):
        raise HTTPException(status_code=422, detail="Invalid GitHub repository name.")

    project_directory = _project_directory(owner_id, project_id)
    if project_directory.exists():
        raise HTTPException(status_code=409, detail="The destination programming project already exists.")
    project_directory.parent.mkdir(parents=True, exist_ok=True)

    environment = _git_environment(access_token)
    repository_url = f"https://github.com/{repository_full_name}.git"
    try:
        result = subprocess.run(
            ["git", "clone", "--depth=1", "--single-branch", "--no-tags", "--progress", repository_url, str(project_directory)],
            capture_output=True,
            text=True,
            timeout=GITHUB_CLONE_TIMEOUT_SECONDS,
            env=environment,
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Git is required to open GitHub repositories on this device.") from exc
    except subprocess.TimeoutExpired as exc:
        if project_directory.is_dir() and not project_directory.is_symlink():
            shutil.rmtree(project_directory)
        raise HTTPException(status_code=504, detail="Cloning the GitHub repository timed out. Try again.") from exc
    except OSError as exc:
        if project_directory.is_dir() and not project_directory.is_symlink():
            shutil.rmtree(project_directory)
        raise HTTPException(status_code=500, detail="Could not start Git to clone the repository.") from exc

    if result.returncode != 0:
        if project_directory.is_dir() and not project_directory.is_symlink():
            shutil.rmtree(project_directory)
        raise HTTPException(
            status_code=502,
            detail="GitHub could not clone this repository. Check its access permissions and try again.",
        )
    return {
        "project_id": project_id,
        "name": repository_full_name,
        "working_directory": str(project_directory),
    }


def _git_environment(access_token: str | None = None) -> dict[str, str]:
    environment = os.environ.copy()
    for key in tuple(environment):
        if (key.startswith(("GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_")) or
                key in {
                    "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "GIT_DIR",
                    "GIT_WORK_TREE", "GIT_INDEX_FILE",
                }):
            environment.pop(key)
    environment.update({
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GCM_INTERACTIVE": "never",
    })
    if access_token:
        credential = base64.b64encode(f"x-access-token:{access_token}".encode("utf-8")).decode("ascii")
        environment.update({
            "GIT_CONFIG_COUNT": "3",
            "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
            "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {credential}",
            "GIT_CONFIG_KEY_1": "credential.helper",
            "GIT_CONFIG_VALUE_1": "",
            "GIT_CONFIG_KEY_2": "credential.interactive",
            "GIT_CONFIG_VALUE_2": "never",
        })
    else:
        environment.update({
            "GIT_CONFIG_COUNT": "2",
            "GIT_CONFIG_KEY_0": "credential.helper",
            "GIT_CONFIG_VALUE_0": "",
            "GIT_CONFIG_KEY_1": "credential.interactive",
            "GIT_CONFIG_VALUE_1": "never",
        })
    return environment


def _run_git(
    project_directory: Path,
    arguments: list[str],
    access_token: str | None = None,
    timeout: int = GIT_OPERATION_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(
            ["git", "-C", str(project_directory), *arguments],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=timeout,
            env=_git_environment(access_token),
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Git is required for repository operations on this device.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="The Git operation timed out. Check the connection and try again.") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Could not start the Git operation.") from exc
    return result


def _git_output(result: subprocess.CompletedProcess[bytes]) -> str:
    return result.stdout.decode("utf-8", errors="replace").strip()


def _github_repository_directory(
    owner_id: str | None,
    project_id: str,
) -> tuple[Path, str]:
    project_directory = _project_directory(owner_id, project_id)
    if not project_directory.is_dir():
        raise HTTPException(status_code=404, detail="The programming repository workspace was not found.")
    root = _run_git(project_directory, ["rev-parse", "--show-toplevel"])
    if root.returncode != 0:
        raise HTTPException(status_code=409, detail="This workspace is not a Git repository.")
    try:
        repository_root = Path(_git_output(root)).resolve(strict=True)
        expected_root = project_directory.resolve(strict=True)
    except OSError as exc:
        raise HTTPException(status_code=400, detail="The Git repository workspace path is invalid.") from exc
    if repository_root != expected_root:
        raise HTTPException(status_code=400, detail="The Git repository is outside its assigned workspace.")

    remote = _run_git(project_directory, ["config", "--get", "remote.origin.url"])
    if remote.returncode != 0:
        raise HTTPException(status_code=409, detail="This Git repository has no GitHub origin.")
    origin = _git_output(remote)
    parsed_origin = urlparse(origin)
    repository_path = parsed_origin.path.removeprefix("/").removesuffix(".git")
    if (parsed_origin.scheme != "https" or parsed_origin.hostname != "github.com" or
            parsed_origin.username or parsed_origin.password or parsed_origin.port or
            not GITHUB_FULL_NAME_PATTERN.fullmatch(repository_path) or
            any(part in {"", ".", ".."} for part in repository_path.split("/"))):
        raise HTTPException(status_code=403, detail="Git operations are only enabled for the linked GitHub repository.")
    return project_directory, repository_path


def git_repository_status(
    owner_id: str | None,
    project_id: str,
) -> dict[str, object]:
    project_directory, repository_full_name = _github_repository_directory(owner_id, project_id)
    result = _run_git(
        project_directory,
        ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"],
    )
    if result.returncode != 0:
        raise HTTPException(status_code=502, detail="Could not read the Git repository status.")

    records = result.stdout.split(b"\0")
    branch = ""
    files: list[dict[str, object]] = []
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if not record:
            continue
        if record.startswith(b"## "):
            branch_line = record[3:].decode("utf-8", errors="replace")
            branch = branch_line.split("...", 1)[0].removesuffix(" (no branch)")
            if branch_line.startswith("No commits yet on "):
                branch = branch_line.removeprefix("No commits yet on ")
            continue
        if len(record) < 4:
            raise HTTPException(status_code=502, detail="Git returned an invalid repository status.")
        status = record[:2].decode("ascii", errors="replace")
        path = record[3:].decode("utf-8", errors="replace")
        if "R" in status or "C" in status:
            index += 1
        if not path or path.startswith("/") or "\\" in path or any(part in {"", ".", ".."} for part in path.split("/")):
            raise HTTPException(status_code=502, detail="Git returned an invalid repository file path.")
        files.append({
            "path": path,
            "status": status,
            "staged": status[0] != " " and status[0] != "?",
            "unstaged": status[1] != " " and status[1] != "?",
            "untracked": status == "??",
        })
    return {
        "repository": repository_full_name,
        "branch": branch or "HEAD",
        "files": files,
        "has_changes": bool(files),
    }


def _validate_git_paths(paths: list[str]) -> list[str]:
    if not paths or len(paths) > 200:
        raise HTTPException(status_code=422, detail="Select between 1 and 200 changed files.")
    normalized = []
    for relative in paths:
        parts = relative.split("/")
        if (not relative or relative.startswith("/") or "\\" in relative or
                any(part in {"", ".", ".."} for part in parts) or
                any(":" in part or "\0" in part for part in parts)):
            raise HTTPException(status_code=422, detail="Git file paths must stay inside the repository.")
        normalized.append(relative)
    if len(set(normalized)) != len(normalized):
        raise HTTPException(status_code=422, detail="The selected Git file paths must be unique.")
    return normalized


def git_stage_repository_files(
    owner_id: str | None,
    project_id: str,
    paths: list[str],
    stage: bool,
) -> dict[str, object]:
    project_directory, _ = _github_repository_directory(owner_id, project_id)
    selected_paths = _validate_git_paths(paths)
    current_status = git_repository_status(owner_id, project_id)
    changed_paths = {
        entry["path"] for entry in current_status["files"]
        if isinstance(entry, dict) and isinstance(entry.get("path"), str)
    }
    if any(path not in changed_paths for path in selected_paths):
        raise HTTPException(status_code=409, detail="The selected files changed. Refresh the repository status and try again.")

    if stage:
        arguments = ["add", "--", *selected_paths]
    else:
        untracked_paths = {
            entry["path"] for entry in current_status["files"]
            if isinstance(entry, dict) and entry.get("untracked") is True
        }
        tracked = [path for path in selected_paths if path not in untracked_paths]
        untracked = [path for path in selected_paths if path in untracked_paths]
        if tracked:
            reset = _run_git(project_directory, ["reset", "-q", "HEAD", "--", *tracked])
            if reset.returncode != 0:
                raise HTTPException(status_code=409, detail="Could not unstage the selected tracked files.")
        if untracked:
            remove = _run_git(project_directory, ["rm", "--cached", "-q", "-f", "--", *untracked])
            if remove.returncode != 0:
                raise HTTPException(status_code=409, detail="Could not unstage the selected new files.")
        return git_repository_status(owner_id, project_id)

    result = _run_git(project_directory, arguments)
    if result.returncode != 0:
        raise HTTPException(status_code=409, detail="Could not stage the selected files.")
    return git_repository_status(owner_id, project_id)


def git_commit_staged_changes(
    owner_id: str | None,
    project_id: str,
    title: str,
    description: str,
    author_name: str,
    author_email: str,
) -> dict[str, object]:
    project_directory, repository_full_name = _github_repository_directory(owner_id, project_id)
    clean_title = title.strip()
    clean_description = description.strip()
    if not clean_title or len(clean_title) > 200 or "\n" in clean_title or "\r" in clean_title:
        raise HTTPException(status_code=422, detail="Enter a one-line commit title up to 200 characters.")
    if len(clean_description) > 5000 or "\0" in clean_description:
        raise HTTPException(status_code=422, detail="The commit description cannot exceed 5,000 characters.")
    if not GIT_AUTHOR_NAME_PATTERN.fullmatch(author_name.strip()):
        raise HTTPException(status_code=422, detail="Enter a valid commit author name.")
    if not GIT_AUTHOR_EMAIL_PATTERN.fullmatch(author_email.strip()):
        raise HTTPException(status_code=422, detail="Enter a valid commit author email.")

    staged = _run_git(project_directory, ["diff", "--cached", "--quiet"])
    if staged.returncode == 0:
        raise HTTPException(status_code=409, detail="Stage at least one file before creating a commit.")
    if staged.returncode != 1:
        raise HTTPException(status_code=502, detail="Could not check the staged repository changes.")

    arguments = [
        "-c", f"user.name={author_name.strip()}",
        "-c", f"user.email={author_email.strip()}",
        "commit", "-m", clean_title,
    ]
    if clean_description:
        arguments.extend(["-m", clean_description])
    commit = _run_git(project_directory, arguments, timeout=GIT_OPERATION_TIMEOUT_SECONDS)
    if commit.returncode != 0:
        raise HTTPException(status_code=409, detail="Git could not create the commit. Check the staged changes and commit details.")
    commit_hash = _run_git(project_directory, ["rev-parse", "--short", "HEAD"])
    if commit_hash.returncode != 0:
        raise HTTPException(status_code=502, detail="The commit was created, but its identifier could not be read.")
    return {
        "repository": repository_full_name,
        "commit": _git_output(commit_hash),
        "status": git_repository_status(owner_id, project_id),
    }


def git_push_repository(
    owner_id: str | None,
    project_id: str,
    access_token: str,
) -> dict[str, object]:
    project_directory, repository_full_name = _github_repository_directory(owner_id, project_id)
    upstream = _run_git(
        project_directory,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    )
    push_arguments = ["push"] if upstream.returncode == 0 else ["push", "--set-upstream", "origin", "HEAD"]
    result = _run_git(
        project_directory,
        push_arguments,
        access_token=access_token,
        timeout=GIT_PUSH_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise HTTPException(
            status_code=502,
            detail="GitHub rejected the push. Check repository write permission, branch protection, and your linked GitHub access.",
        )
    return {
        "repository": repository_full_name,
        "status": git_repository_status(owner_id, project_id),
    }


def read_project_workspace(
    owner_id: str | None,
    project_id: str,
) -> dict[str, list[dict[str, str]] | bool]:
    project_directory = _project_directory(owner_id, project_id)
    if not project_directory.exists():
        return {"files": [], "truncated": False}
    if not project_directory.is_dir():
        raise HTTPException(status_code=400, detail="The programming project path is not a directory.")

    files: list[dict[str, str]] = []
    candidate_paths: list[Path] = []
    total_bytes = 0
    truncated = False

    def raise_walk_error(error: OSError) -> None:
        raise error

    scanned_entries = 0
    try:
        for directory, directories, filenames in os.walk(
            project_directory,
            topdown=True,
            onerror=raise_walk_error,
            followlinks=False,
        ):
            current_directory = Path(directory)
            directories[:] = sorted(
                name for name in directories
                if name not in IGNORED_WORKSPACE_PARTS and not (current_directory / name).is_symlink()
            )
            for filename in sorted(filenames):
                scanned_entries += 1
                if scanned_entries > MAX_CONTEXT_SCAN_ENTRIES:
                    truncated = True
                    break
                path = current_directory / filename
                if path.is_symlink() or filename.lower() in SENSITIVE_WORKSPACE_NAMES or filename.lower().startswith(".env."):
                    continue
                candidate_paths.append(path)
            if truncated:
                break
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Could not enumerate programming workspace files.") from exc

    for path in sorted(candidate_paths):
        relative = path.relative_to(project_directory)
        if not path.is_file():
            continue
        if len(files) >= MAX_CONTEXT_FILES:
            truncated = True
            break
        try:
            size = path.stat().st_size
            if size > MAX_CONTEXT_FILE_BYTES:
                truncated = True
                continue
            if total_bytes + size > MAX_CONTEXT_BYTES:
                truncated = True
                continue
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Could not read project file '{relative}'.") from exc
        if "\0" in content:
            continue
        files.append({"path": relative.as_posix(), "content": content})
        total_bytes += size
    return {"files": files, "truncated": truncated}


def run_project_command(
    owner_id: str | None,
    project_id: str,
    shell: Literal["cmd", "powershell"],
    command: str,
    files: list[dict[str, str]],
) -> dict[str, str | int | bool]:
    if not command.strip() or len(command) > MAX_COMMAND_LENGTH:
        raise HTTPException(status_code=422, detail="Enter a command up to 2,000 characters.")

    project_directory = _project_directory(owner_id, project_id)
    if project_directory.exists() and not project_directory.is_dir():
        raise HTTPException(status_code=400, detail="The programming project path is not a directory.")
    project_directory.mkdir(parents=True, exist_ok=True)
    _write_project_files(project_directory, files)

    if shell == "cmd":
        executable = os.environ.get("COMSPEC", "cmd.exe")
        arguments = f'{subprocess.list2cmdline([executable])} /d /s /c "{command}"'
    else:
        executable = shutil.which("pwsh") or shutil.which("powershell")
        if not executable:
            raise HTTPException(status_code=503, detail="PowerShell is not installed or is not available on PATH.")
        arguments = [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]

    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    with tempfile.TemporaryFile(mode="w+b") as output_file:
        try:
            process = subprocess.Popen(
                arguments,
                cwd=project_directory,
                stdin=subprocess.DEVNULL,
                stdout=output_file,
                stderr=subprocess.STDOUT,
                creationflags=creation_flags,
            )
        except OSError as exc:
            raise HTTPException(status_code=503, detail=f"Could not start the requested shell: {exc}") from exc

        deadline = time.monotonic() + COMMAND_TIMEOUT_SECONDS
        timed_out = False
        output_truncated = False
        while process.poll() is None:
            if os.fstat(output_file.fileno()).st_size > MAX_CAPTURE_BYTES:
                output_truncated = True
                process.kill()
                break
            if time.monotonic() >= deadline:
                timed_out = True
                process.kill()
                break
            time.sleep(0.05)

        exit_code = process.wait()
        output_size = os.fstat(output_file.fileno()).st_size
        output_truncated = output_truncated or output_size > MAX_CAPTURE_BYTES
        output_file.seek(max(0, output_size - MAX_OUTPUT_LENGTH))
        output = output_file.read(MAX_OUTPUT_LENGTH).decode("utf-8", errors="replace")

    return {
        "exit_code": -1 if timed_out else exit_code,
        "output": output,
        "timed_out": timed_out,
        "output_truncated": output_truncated or output_size > MAX_OUTPUT_LENGTH,
        "working_directory": str(project_directory),
    }
