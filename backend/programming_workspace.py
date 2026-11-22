from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import HTTPException


WORKSPACE_ROOT = Path(__file__).resolve().parent / "data" / "programming-workspaces"
PROJECT_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")
VSCODE_INSTALLER_URLS = {
    "AMD64": "https://update.code.visualstudio.com/latest/win32-x64-user/stable",
    "ARM64": "https://update.code.visualstudio.com/latest/win32-arm64-user/stable",
    "x86": "https://update.code.visualstudio.com/latest/win32-ia32-user/stable",
}
VSCODE_EXTENSION_ID = "taskflow.taskflow-vscode-bridge"
VSCODE_BRIDGE_PORT_START = 17391
VSCODE_BRIDGE_PORT_END = 17410
VSCODE_BRIDGE_START_TIMEOUT_SECONDS = 60
VSCODE_INSTALLER_MAX_BYTES = 200 * 1024 * 1024
VSCODE_INSTALLER_TIMEOUT_SECONDS = 900
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


def _find_vscode_executable() -> Path | None:
    candidates: list[Path] = []
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "Programs" / "Microsoft VS Code" / "Code.exe")
    for variable in ("ProgramFiles", "ProgramFiles(x86)"):
        program_files = os.environ.get(variable)
        if program_files:
            candidates.append(Path(program_files) / "Microsoft VS Code" / "Code.exe")

    code_command = shutil.which("code")
    if code_command:
        command_path = Path(code_command)
        candidates.append(command_path.parent.parent / "Code.exe")
        if command_path.suffix.lower() == ".exe":
            candidates.append(command_path)

    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def _vscode_instance_matches_current_session(executable: Path) -> bool:
    if os.name != "nt":
        return False

    from ctypes import wintypes

    class ProcessEntry32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    class TokenElevation(ctypes.Structure):
        _fields_ = [("TokenIsElevated", wintypes.DWORD)]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.ProcessIdToSessionId.argtypes = [wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    kernel32.ProcessIdToSessionId.restype = wintypes.BOOL
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD),
    ]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetTokenInformation.restype = wintypes.BOOL

    def token_is_elevated(token: wintypes.HANDLE) -> bool | None:
        elevation = TokenElevation()
        returned_size = wintypes.DWORD()
        if not advapi32.GetTokenInformation(
            token, 20, ctypes.byref(elevation), ctypes.sizeof(elevation), ctypes.byref(returned_size),
        ):
            return None
        return bool(elevation.TokenIsElevated)

    current_token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(
        kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(current_token),
    ):
        return False
    try:
        current_elevation = token_is_elevated(current_token)
    finally:
        kernel32.CloseHandle(current_token)
    if current_elevation is None:
        return False

    current_session = wintypes.DWORD()
    if not kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(current_session)):
        return False

    snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        return False
    expected_executable = os.path.normcase(os.path.abspath(executable))
    try:
        entry = ProcessEntry32W()
        entry.dwSize = ctypes.sizeof(entry)
        has_process = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while has_process:
            if entry.szExeFile.lower() == "code.exe":
                process = kernel32.OpenProcess(0x1000, False, entry.th32ProcessID)
                if process:
                    try:
                        session = wintypes.DWORD()
                        image = ctypes.create_unicode_buffer(32768)
                        image_size = wintypes.DWORD(len(image))
                        if (
                            kernel32.ProcessIdToSessionId(entry.th32ProcessID, ctypes.byref(session))
                            and session.value == current_session.value
                            and kernel32.QueryFullProcessImageNameW(
                                process, 0, image, ctypes.byref(image_size),
                            )
                            and os.path.normcase(os.path.abspath(image.value)) == expected_executable
                        ):
                            process_token = wintypes.HANDLE()
                            if advapi32.OpenProcessToken(process, 0x0008, ctypes.byref(process_token)):
                                try:
                                    if token_is_elevated(process_token) == current_elevation:
                                        return True
                                finally:
                                    kernel32.CloseHandle(process_token)
                    finally:
                        kernel32.CloseHandle(process)
            has_process = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    return False


def _run_as_interactive_user(
    executable: Path,
    arguments: list[str],
    working_directory: Path,
    timeout: int,
    wait: bool = True,
) -> int | None:
    if os.name != "nt":
        raise HTTPException(status_code=501, detail="Launching desktop applications is supported on Windows only.")
    command = [str(executable), *arguments]
    if not ctypes.windll.shell32.IsUserAnAdmin():
        try:
            if wait:
                result = subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    cwd=str(working_directory),
                    timeout=timeout,
                    check=False,
                )
                return result.returncode
            subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                cwd=str(working_directory),
                close_fds=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return None
        except subprocess.TimeoutExpired:
            raise
        except OSError as exc:
            raise HTTPException(status_code=503, detail=f"Could not launch {executable.name}: {exc}") from exc

    from ctypes import wintypes

    class StartupInfoW(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("lpReserved", wintypes.LPWSTR),
            ("lpDesktop", wintypes.LPWSTR),
            ("lpTitle", wintypes.LPWSTR),
            ("dwX", wintypes.DWORD),
            ("dwY", wintypes.DWORD),
            ("dwXSize", wintypes.DWORD),
            ("dwYSize", wintypes.DWORD),
            ("dwXCountChars", wintypes.DWORD),
            ("dwYCountChars", wintypes.DWORD),
            ("dwFillAttribute", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("wShowWindow", wintypes.WORD),
            ("cbReserved2", wintypes.WORD),
            ("lpReserved2", ctypes.POINTER(ctypes.c_ubyte)),
            ("hStdInput", wintypes.HANDLE),
            ("hStdOutput", wintypes.HANDLE),
            ("hStdError", wintypes.HANDLE),
        ]

    class ProcessInformation(ctypes.Structure):
        _fields_ = [
            ("hProcess", wintypes.HANDLE),
            ("hThread", wintypes.HANDLE),
            ("dwProcessId", wintypes.DWORD),
            ("dwThreadId", wintypes.DWORD),
        ]

    class SidAndAttributes(ctypes.Structure):
        _fields_ = [("sid", ctypes.c_void_p), ("attributes", wintypes.DWORD)]

    class TokenIntegrityLevel(ctypes.Structure):
        _fields_ = [("label", SidAndAttributes)]

    class Luid(ctypes.Structure):
        _fields_ = [("low_part", wintypes.DWORD), ("high_part", ctypes.c_long)]

    class LuidAndAttributes(ctypes.Structure):
        _fields_ = [("luid", Luid), ("attributes", wintypes.DWORD)]

    class TokenPrivileges(ctypes.Structure):
        _fields_ = [("count", wintypes.DWORD), ("privileges", LuidAndAttributes * 2)]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL
    advapi32.ConvertStringSidToSidW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_void_p)]
    advapi32.ConvertStringSidToSidW.restype = wintypes.BOOL
    advapi32.CreateRestrictedToken.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(SidAndAttributes),
        wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.CreateRestrictedToken.restype = wintypes.BOOL
    advapi32.DuplicateTokenEx.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p, ctypes.c_int,
        ctypes.c_int, ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.DuplicateTokenEx.restype = wintypes.BOOL
    advapi32.SetTokenInformation.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
    ]
    advapi32.SetTokenInformation.restype = wintypes.BOOL
    advapi32.GetLengthSid.argtypes = [ctypes.c_void_p]
    advapi32.GetLengthSid.restype = wintypes.DWORD
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.LookupPrivilegeValueW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(Luid)]
    advapi32.LookupPrivilegeValueW.restype = wintypes.BOOL
    advapi32.AdjustTokenPrivileges.argtypes = [
        wintypes.HANDLE, wintypes.BOOL, ctypes.POINTER(TokenPrivileges), wintypes.DWORD,
        ctypes.POINTER(TokenPrivileges), ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.AdjustTokenPrivileges.restype = wintypes.BOOL
    advapi32.CreateProcessWithTokenW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPWSTR,
        wintypes.DWORD, ctypes.c_void_p, wintypes.LPCWSTR,
        ctypes.POINTER(StartupInfoW), ctypes.POINTER(ProcessInformation),
    ]
    advapi32.CreateProcessWithTokenW.restype = wintypes.BOOL
    advapi32.CreateProcessAsUserW.argtypes = [
        wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.c_void_p,
        ctypes.c_void_p, wintypes.BOOL, wintypes.DWORD, ctypes.c_void_p,
        wintypes.LPCWSTR, ctypes.POINTER(StartupInfoW), ctypes.POINTER(ProcessInformation),
    ]
    advapi32.CreateProcessAsUserW.restype = wintypes.BOOL

    def close(handle):
        if handle:
            kernel32.CloseHandle(handle)

    current_token = wintypes.HANDLE()
    restricted_token = wintypes.HANDLE()
    primary_token = wintypes.HANDLE()
    child_process = ProcessInformation()
    administrators_sid = ctypes.c_void_p()
    local_admin_sid = ctypes.c_void_p()
    medium_integrity_sid = ctypes.c_void_p()
    try:
        if not advapi32.ConvertStringSidToSidW("S-1-5-32-544", ctypes.byref(administrators_sid)):
            raise HTTPException(status_code=503, detail="Could not identify the Windows administrators group.")
        if not advapi32.ConvertStringSidToSidW("S-1-5-114", ctypes.byref(local_admin_sid)):
            raise HTTPException(status_code=503, detail="Could not identify the Windows local-administrator group.")
        if not advapi32.ConvertStringSidToSidW("S-1-16-8192", ctypes.byref(medium_integrity_sid)):
            raise HTTPException(status_code=503, detail="Could not prepare standard-user process integrity.")
        if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0002 | 0x0008 | 0x0020 | 0x0080, ctypes.byref(current_token)):
            raise HTTPException(status_code=503, detail="Could not inspect the current Windows user account.")

        disabled_sids = (SidAndAttributes * 2)(
            SidAndAttributes(administrators_sid, 0),
            SidAndAttributes(local_admin_sid, 0),
        )
        if not advapi32.CreateRestrictedToken(
            current_token, 0x00000001, 2, disabled_sids,
            0, None, 0, None, ctypes.byref(restricted_token),
        ):
            raise HTTPException(status_code=503, detail="Could not create a restricted user token; refusing to run VS Code with administrator privileges.")
        integrity_label = TokenIntegrityLevel(SidAndAttributes(medium_integrity_sid, 0x00000020))
        integrity_size = ctypes.sizeof(integrity_label) + advapi32.GetLengthSid(medium_integrity_sid)
        if not advapi32.SetTokenInformation(restricted_token, 25, ctypes.byref(integrity_label), integrity_size):
            raise HTTPException(status_code=503, detail="Could not lower VS Code to standard-user integrity.")
        if not advapi32.DuplicateTokenEx(restricted_token, 0x0000000B, None, 2, 1, ctypes.byref(primary_token)):
            raise HTTPException(status_code=503, detail="Could not prepare the restricted Windows process token.")

        command_line = ctypes.create_unicode_buffer(subprocess.list2cmdline(command))
        startup_info = StartupInfoW()
        startup_info.cb = ctypes.sizeof(startup_info)
        startup_info.lpDesktop = "winsta0\\default"
        creation_flags = 0x00000008 if not wait else 0
        created = advapi32.CreateProcessWithTokenW(
            primary_token, 0, str(executable), command_line, creation_flags,
            None, str(working_directory), ctypes.byref(startup_info), ctypes.byref(child_process),
        )
        error = ctypes.get_last_error() if not created else 0
        if not created:
            enabled_privileges = TokenPrivileges()
            enabled_privileges.count = 2
            for index, name in enumerate(("SeIncreaseQuotaPrivilege", "SeAssignPrimaryTokenPrivilege")):
                if not advapi32.LookupPrivilegeValueW(None, name, ctypes.byref(enabled_privileges.privileges[index].luid)):
                    raise HTTPException(status_code=503, detail=f"Could not prepare the Windows {name} privilege.")
                enabled_privileges.privileges[index].attributes = 0x00000002
            previous_privileges = TokenPrivileges()
            previous_size = wintypes.DWORD(ctypes.sizeof(previous_privileges))
            ctypes.set_last_error(0)
            if not advapi32.AdjustTokenPrivileges(
                current_token, False, ctypes.byref(enabled_privileges), previous_size.value,
                ctypes.byref(previous_privileges), ctypes.byref(previous_size),
            ) or ctypes.get_last_error() == 1300:
                raise HTTPException(status_code=503, detail="Could not enable the temporary Windows process-launch privileges.")
            created = advapi32.CreateProcessAsUserW(
                primary_token,
                str(executable),
                command_line,
                None,
                None,
                False,
                creation_flags,
                None,
                str(working_directory),
                ctypes.byref(startup_info),
                ctypes.byref(child_process),
            )
            error = ctypes.get_last_error() if not created else 0
            advapi32.AdjustTokenPrivileges(
                current_token, False, ctypes.byref(previous_privileges), 0, None, None,
            )
        if not created:
            raise HTTPException(status_code=503, detail=f"Could not launch VS Code setup as the current non-elevated user (Windows error {error}).")

        close(child_process.hThread)
        child_process.hThread = None
        if not wait:
            return None

        wait_result = kernel32.WaitForSingleObject(child_process.hProcess, timeout * 1000)
        if wait_result == 0x00000102:
            kernel32.TerminateProcess(child_process.hProcess, 1)
            raise subprocess.TimeoutExpired(str(executable), timeout)
        if wait_result != 0:
            raise HTTPException(status_code=503, detail="Could not wait for the VS Code setup process to finish.")
        exit_code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(child_process.hProcess, ctypes.byref(exit_code)):
            raise HTTPException(status_code=503, detail="Could not read the VS Code setup result.")
        return int(exit_code.value)
    finally:
        close(child_process.hThread)
        close(child_process.hProcess)
        close(primary_token)
        close(restricted_token)
        close(current_token)
        if administrators_sid:
            kernel32.LocalFree(administrators_sid)
        if local_admin_sid:
            kernel32.LocalFree(local_admin_sid)
        if medium_integrity_sid:
            kernel32.LocalFree(medium_integrity_sid)


def _verify_vscode_installer(installer_path: Path) -> None:
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    if not powershell:
        raise HTTPException(status_code=503, detail="PowerShell is required to verify the Microsoft VS Code installer signature.")
    script = (
        "$signature = Get-AuthenticodeSignature -LiteralPath $env:TASKFLOW_VSCODE_INSTALLER; "
        "$signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }; "
        "@{ status = $signature.Status.ToString(); signer = $signer } | ConvertTo-Json -Compress"
    )
    environment = {**os.environ, "TASKFLOW_VSCODE_INSTALLER": str(installer_path)}
    try:
        result = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=30,
            env=environment,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(status_code=503, detail="Could not verify the downloaded VS Code installer signature.") from exc
    try:
        signature = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Microsoft installer signature verification returned an invalid result.") from exc
    signer = signature.get("signer", "") if isinstance(signature, dict) else ""
    status = signature.get("status", "") if isinstance(signature, dict) else ""
    if result.returncode != 0 or status != "Valid" or "Microsoft Corporation" not in signer:
        raise HTTPException(status_code=502, detail="The downloaded VS Code installer does not have a valid Microsoft Corporation signature.")


def _download_vscode_installer(installer_path: Path) -> None:
    architecture = platform.machine().upper()
    installer_url = VSCODE_INSTALLER_URLS.get(architecture)
    if not installer_url:
        raise HTTPException(status_code=501, detail=f"Automatic VS Code installation is not supported on Windows architecture {architecture or 'unknown'}.")
    request = urllib.request.Request(
        installer_url,
        headers={"User-Agent": "AI-TaskFlow-VSCode-Setup/1.0"},
    )
    deadline = time.monotonic() + VSCODE_INSTALLER_TIMEOUT_SECONDS
    total_bytes = 0
    try:
        with urllib.request.urlopen(request, timeout=30) as response, installer_path.open("wb") as installer_file:
            if not response.geturl().lower().startswith("https://"):
                raise HTTPException(status_code=502, detail="Microsoft installer download did not remain on HTTPS.")
            while chunk := response.read(1024 * 1024):
                if time.monotonic() > deadline:
                    raise HTTPException(status_code=504, detail="Downloading the VS Code installer timed out.")
                total_bytes += len(chunk)
                if total_bytes > VSCODE_INSTALLER_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="The VS Code installer download exceeded the size limit.")
                installer_file.write(chunk)
    except HTTPException:
        raise
    except (OSError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Could not download VS Code from Microsoft: {exc}") from exc
    if total_bytes == 0:
        raise HTTPException(status_code=502, detail="Microsoft returned an empty VS Code installer.")


def _install_vscode_user_setup() -> Path:
    with tempfile.TemporaryDirectory(prefix="taskflow-vscode-") as temporary_directory:
        installer_path = Path(temporary_directory) / "VSCodeSetup.exe"
        _download_vscode_installer(installer_path)
        _verify_vscode_installer(installer_path)
        try:
            exit_code = _run_as_interactive_user(
                installer_path,
                ["/VERYSILENT", "/NORESTART", "/MERGETASKS=!runcode"],
                Path(temporary_directory),
                VSCODE_INSTALLER_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="Installing Visual Studio Code timed out.") from exc
        if exit_code != 0:
            raise HTTPException(status_code=500, detail=f"The VS Code user installer failed with exit code {exit_code}.")

    executable = _find_vscode_executable()
    if not executable:
        raise HTTPException(status_code=500, detail="VS Code installer completed, but Code.exe could not be found.")
    return executable


def _find_vscode_cli(executable: Path) -> Path:
    cli = executable.parent / "bin" / "code.cmd"
    if cli.is_file():
        return cli.resolve()
    cli = executable.parent / "bin" / "code"
    if cli.is_file():
        return cli.resolve()
    return executable


def _find_vscode_bridge_port(project_directory: Path) -> int | None:
    expected_workspace = os.path.normcase(os.path.normpath(str(project_directory)))
    for port in range(VSCODE_BRIDGE_PORT_START, VSCODE_BRIDGE_PORT_END + 1):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=0.25) as response:
                if response.status != 200:
                    continue
                health = json.loads(response.read(65_537).decode("utf-8"))
        except (OSError, TimeoutError, urllib.error.URLError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if not isinstance(health, dict) or health.get("running") is not True:
            continue
        workspace_directory = health.get("workspace_directory")
        if (
            isinstance(workspace_directory, str)
            and os.path.normcase(os.path.normpath(workspace_directory)) == expected_workspace
        ):
            return port
    return None


def _wait_for_vscode_bridge(project_directory: Path) -> int:
    deadline = time.monotonic() + VSCODE_BRIDGE_START_TIMEOUT_SECONDS
    while True:
        port = _find_vscode_bridge_port(project_directory)
        if port is not None:
            return port
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise HTTPException(
                status_code=504,
                detail=(
                    "VS Code was opened, but its TF CODE extension did not start. "
                    "Approve any Workspace Trust prompt, then reload the VS Code window."
                ),
            )
        time.sleep(min(0.5, remaining))


def _ensure_vscode_extension(executable: Path, extension_package: Path) -> None:
    vscode_cli = _find_vscode_cli(executable)
    try:
        with zipfile.ZipFile(extension_package) as archive:
            package_metadata = json.loads(archive.read("extension/package.json").decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=500, detail="The bundled TF CODE extension metadata is unavailable or invalid.") from exc
    expected_version = package_metadata.get("version") if isinstance(package_metadata, dict) else None
    if not isinstance(expected_version, str):
        raise HTTPException(status_code=500, detail="The bundled TF CODE extension version is missing.")

    try:
        installed = subprocess.run(
            [str(vscode_cli), "--list-extensions", "--show-versions"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(status_code=503, detail="Could not inspect the installed VS Code extensions.") from exc
    if installed.returncode != 0:
        raise HTTPException(status_code=500, detail=f"VS Code could not list installed extensions. {(installed.stderr or '').strip()[-1000:]}")
    extension_line = next(
        (line.strip() for line in installed.stdout.splitlines()
         if line.strip().lower().startswith(f"{VSCODE_EXTENSION_ID}@")),
        "",
    )
    installed_version = extension_line.rsplit("@", 1)[-1] if extension_line else ""
    try:
        installed_version_tuple = tuple(int(part) for part in installed_version.split("."))
        expected_version_tuple = tuple(int(part) for part in expected_version.split("."))
    except ValueError:
        installed_version_tuple = ()
        expected_version_tuple = ()
    if installed_version_tuple and expected_version_tuple and installed_version_tuple >= expected_version_tuple:
        return

    try:
        install_exit_code = _run_as_interactive_user(
            vscode_cli,
            ["--install-extension", str(extension_package), "--force"],
            executable.parent,
            180,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(status_code=503, detail="Could not install the bundled TF CODE VS Code extension.") from exc
    if install_exit_code != 0:
        raise HTTPException(status_code=500, detail=f"VS Code failed to install the TF CODE extension with exit code {install_exit_code}.")


def launch_vscode_project(owner_id: str | None, project_id: str) -> dict[str, str | bool | int]:
    if os.name != "nt":
        raise HTTPException(status_code=501, detail="Automatic VS Code setup is currently supported on Windows only.")
    project_directory = _project_directory(owner_id, project_id)
    if not project_directory.is_dir():
        raise HTTPException(status_code=404, detail="The TF CODE project workspace does not exist.")

    bridge_port = _find_vscode_bridge_port(project_directory)
    application_root = Path(__file__).resolve().parent.parent
    extension_package = application_root / "vscode-extension" / "TF-CODE-Agent-Bridge.vsix"
    if not extension_package.is_file():
        extension_package = application_root / "release" / "TF-CODE-Agent-Bridge.vsix"
    if not extension_package.is_file():
        raise HTTPException(status_code=500, detail="The TF CODE extension package is missing from this installation.")
    executable = _find_vscode_executable() or _install_vscode_user_setup()
    if bridge_port is None:
        _ensure_vscode_extension(executable, extension_package)
        try:
            launch_arguments = ["--new-window", str(project_directory)]
            if _vscode_instance_matches_current_session(executable):
                subprocess.Popen(
                    [str(executable), *launch_arguments],
                    stdin=subprocess.DEVNULL,
                    cwd=str(project_directory),
                    close_fds=True,
                )
            else:
                _run_as_interactive_user(
                    executable,
                    launch_arguments,
                    project_directory,
                    30,
                    wait=False,
                )
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="Opening the project in VS Code timed out.") from exc
        except OSError as exc:
            raise HTTPException(status_code=503, detail=f"Could not open the project in VS Code: {exc}") from exc
        bridge_port = _wait_for_vscode_bridge(project_directory)
    return {
        "launched": True,
        "vscode_path": str(executable),
        "workspace_directory": str(project_directory),
        "extension_id": VSCODE_EXTENSION_ID,
        "bridge_port": bridge_port,
    }


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
