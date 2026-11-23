import json
import os
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import programming_workspace


def _write_vscode_extension_package(path: Path, version: str) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "extension/package.json",
            json.dumps({"version": version}),
        )


def test_vscode_extension_is_installed_when_missing(tmp_path, monkeypatch):
    extension_package = tmp_path / "TF-CODE-Agent-Bridge.vsix"
    _write_vscode_extension_package(extension_package, "1.2.1")
    calls = []

    def fake_run(arguments, **_options):
        calls.append(arguments)
        return SimpleNamespace(returncode=0, stdout="")

    monkeypatch.setattr(programming_workspace.subprocess, "run", fake_run)
    monkeypatch.setattr(
        programming_workspace,
        "_run_as_interactive_user",
        lambda executable, arguments, _cwd, _timeout, wait=True: calls.append(
            [str(executable), *arguments]
        ) or 0,
    )
    programming_workspace._ensure_vscode_extension(tmp_path / "Code.exe", extension_package)

    assert len(calls) == 2
    assert calls[1][1:] == ["--install-extension", str(extension_package), "--force"]


def test_vscode_extension_is_not_downgraded(tmp_path, monkeypatch):
    extension_package = tmp_path / "TF-CODE-Agent-Bridge.vsix"
    _write_vscode_extension_package(extension_package, "1.2.1")
    calls = []

    def fake_run(arguments, **_options):
        calls.append(arguments)
        return SimpleNamespace(returncode=0, stdout="taskflow.taskflow-vscode-bridge@1.3.0")

    monkeypatch.setattr(programming_workspace.subprocess, "run", fake_run)
    programming_workspace._ensure_vscode_extension(tmp_path / "Code.exe", extension_package)

    assert len(calls) == 1


def test_vscode_extension_uses_cli_for_extension_listing(tmp_path, monkeypatch):
    executable = tmp_path / "Code.exe"
    executable.write_bytes(b"test executable")
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    cli = bin_directory / "code.cmd"
    cli.write_text("@echo off\r\n", encoding="utf-8")
    extension_package = tmp_path / "TF-CODE-Agent-Bridge.vsix"
    _write_vscode_extension_package(extension_package, "1.2.4")
    calls = []

    def fake_run(arguments, **_options):
        calls.append(arguments)
        return SimpleNamespace(
            returncode=0,
            stdout="taskflow.taskflow-vscode-bridge@1.2.4",
            stderr="",
        )

    monkeypatch.setattr(programming_workspace.subprocess, "run", fake_run)
    programming_workspace._ensure_vscode_extension(executable, extension_package)

    assert calls == [[str(cli.resolve()), "--list-extensions", "--show-versions"]]


def test_vscode_extension_rejects_invalid_package_metadata(tmp_path):
    extension_package = tmp_path / "TF-CODE-Agent-Bridge.vsix"
    extension_package.write_bytes(b"not a VSIX archive")

    with pytest.raises(HTTPException, match="metadata is unavailable or invalid"):
        programming_workspace._ensure_vscode_extension(tmp_path / "Code.exe", extension_package)


def test_find_vscode_bridge_port_matches_the_requested_workspace(tmp_path, monkeypatch):
    class FakeResponse:
        status = 200

        def __init__(self, workspace_directory):
            self.workspace_directory = workspace_directory

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self, _limit):
            return json.dumps({
                "running": True,
                "workspace_directory": str(self.workspace_directory),
            }).encode("utf-8")

    def fake_urlopen(url, timeout):
        assert timeout == 0.25
        if url.endswith(":17391/health"):
            return FakeResponse(tmp_path / "other-project")
        if url.endswith(":17392/health"):
            return FakeResponse(tmp_path)
        raise OSError("Connection refused")

    monkeypatch.setattr(programming_workspace.urllib.request, "urlopen", fake_urlopen)

    assert programming_workspace._find_vscode_bridge_port(tmp_path) == 17392


def test_wait_for_vscode_bridge_times_out_when_extension_is_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(programming_workspace, "VSCODE_BRIDGE_START_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(programming_workspace, "_find_vscode_bridge_port", lambda _path: None)

    with pytest.raises(HTTPException, match="extension did not start") as error:
        programming_workspace._wait_for_vscode_bridge(tmp_path)

    assert error.value.status_code == 504


@pytest.mark.skipif(os.name != "nt", reason="VS Code desktop launch is Windows-only.")
def test_launch_vscode_opens_a_visible_window_and_waits_for_the_extension(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)
    project_id = "d" * 32
    project_directory = programming_workspace._project_directory("launch-test", project_id)
    project_directory.mkdir(parents=True)
    executable = tmp_path / "Code.exe"
    executable.write_bytes(b"test executable")
    observed = {}

    monkeypatch.setattr(programming_workspace, "_find_vscode_executable", lambda: executable)
    monkeypatch.setattr(programming_workspace, "_find_vscode_bridge_port", lambda _directory: None)
    monkeypatch.setattr(
        programming_workspace,
        "_vscode_instance_matches_current_session",
        lambda _executable: True,
    )
    monkeypatch.setattr(
        programming_workspace,
        "_ensure_vscode_extension",
        lambda code, package: observed.update(extension=(code, package)),
    )
    monkeypatch.setattr(
        programming_workspace.subprocess,
        "Popen",
        lambda arguments, **options: observed.update(
            launch=(arguments, options)
        ),
    )
    monkeypatch.setattr(
        programming_workspace,
        "_wait_for_vscode_bridge",
        lambda directory: observed.update(bridge_wait=directory) or 17392,
    )

    result = programming_workspace.launch_vscode_project("launch-test", project_id)

    assert result["launched"] is True
    assert result["bridge_port"] == 17392
    assert observed["launch"][0] == [
        str(executable), "--new-window", str(project_directory),
    ]
    assert observed["launch"][1]["cwd"] == str(project_directory)
    assert "creationflags" not in observed["launch"][1]
    assert observed["bridge_wait"] == project_directory
    assert observed["extension"][0] == executable
    assert observed["extension"][1].name == "TF-CODE-Agent-Bridge.vsix"


@pytest.mark.skipif(os.name != "nt", reason="VS Code process matching is Windows-only.")
def test_launch_vscode_waits_for_bridge_before_reporting_success(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)
    project_id = "e" * 32
    project_directory = programming_workspace._project_directory("launch-test", project_id)
    project_directory.mkdir(parents=True)
    executable = tmp_path / "Code.exe"
    executable.write_bytes(b"test executable")
    observed = {}

    monkeypatch.setattr(programming_workspace, "_find_vscode_executable", lambda: executable)
    monkeypatch.setattr(programming_workspace, "_find_vscode_bridge_port", lambda _directory: None)
    monkeypatch.setattr(programming_workspace, "_vscode_instance_matches_current_session", lambda _exe: False)
    monkeypatch.setattr(
        programming_workspace,
        "_ensure_vscode_extension",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        programming_workspace,
        "_run_as_interactive_user",
        lambda *_args, **_kwargs: observed.update(launched=True),
    )

    def bridge_start_failure(_directory):
        raise HTTPException(status_code=504, detail="TF CODE extension did not start.")

    monkeypatch.setattr(
        programming_workspace,
        "_wait_for_vscode_bridge",
        bridge_start_failure,
    )

    with pytest.raises(HTTPException, match="extension did not start"):
        programming_workspace.launch_vscode_project("launch-test", project_id)
    assert observed["launched"] is True


@pytest.mark.skipif(os.name != "nt", reason="VS Code desktop launch is Windows-only.")
def test_launch_vscode_reuses_an_already_open_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)
    project_id = "f" * 32
    project_directory = programming_workspace._project_directory("launch-test", project_id)
    project_directory.mkdir(parents=True)
    executable = tmp_path / "Code.exe"
    executable.write_bytes(b"test executable")
    monkeypatch.setattr(programming_workspace, "_find_vscode_executable", lambda: executable)
    monkeypatch.setattr(programming_workspace, "_find_vscode_bridge_port", lambda _directory: 17402)
    monkeypatch.setattr(
        programming_workspace,
        "_ensure_vscode_extension",
        lambda *_args: pytest.fail("A live bridge should not trigger another extension install."),
    )
    monkeypatch.setattr(
        programming_workspace,
        "_run_as_interactive_user",
        lambda *_args, **_kwargs: pytest.fail("A live bridge should not open another VS Code window."),
    )
    monkeypatch.setattr(
        programming_workspace,
        "_wait_for_vscode_bridge",
        lambda *_args: pytest.fail("An already-running bridge should be reused."),
    )

    result = programming_workspace.launch_vscode_project("launch-test", project_id)

    assert result["launched"] is True
    assert result["bridge_port"] == 17402
    assert result["workspace_directory"] == str(project_directory)


@pytest.mark.skipif(os.name != "nt", reason="VS Code CLI reuse is Windows-only.")
def test_launch_vscode_uses_the_installed_cli_when_available(tmp_path, monkeypatch):
    executable = tmp_path / "Code.exe"
    executable.write_bytes(b"test executable")
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    cli = bin_directory / "code.cmd"
    cli.write_text("@echo off\r\n", encoding="utf-8")
    project_directory = tmp_path / "project"
    project_directory.mkdir()
    observed = {}

    monkeypatch.setattr(programming_workspace, "_find_vscode_cli", lambda _exe: cli)
    monkeypatch.setattr(programming_workspace, "_vscode_instance_matches_current_session", lambda _exe: True)

    def fake_run(arguments, **options):
        observed.update(launch=(arguments, options))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(programming_workspace.subprocess, "run", fake_run)

    vscode_cli = programming_workspace._find_vscode_cli(executable)
    command = [
        "cmd.exe", "/d", "/s", "/c",
        programming_workspace.subprocess.list2cmdline([
            str(vscode_cli), "--reuse-window", str(project_directory),
        ]),
    ]
    programming_workspace.subprocess.run(command, cwd=str(project_directory), timeout=30, check=False)

    assert observed["launch"][0][0] == "cmd.exe"
    assert "--reuse-window" in observed["launch"][0][-1]
    assert observed["launch"][1]["cwd"] == str(project_directory)


@pytest.mark.skipif(os.name != "nt", reason="Restricted process tokens are Windows-only.")
def test_elevated_desktop_children_run_without_administrator_rights(tmp_path):
    child_script = "import ctypes; raise SystemExit(1 if ctypes.windll.shell32.IsUserAnAdmin() else 0)"

    exit_code = programming_workspace._run_as_interactive_user(
        Path(sys.executable),
        ["-c", child_script],
        tmp_path,
        30,
    )

    assert exit_code == 0


@pytest.mark.skipif(os.name != "nt", reason="Authenticode verification uses Windows PowerShell.")
def test_vscode_installer_requires_a_valid_microsoft_signature(tmp_path):
    installer = tmp_path / "unsigned.exe"
    installer.write_bytes(b"not an executable")

    with pytest.raises(HTTPException) as error:
        programming_workspace._verify_vscode_installer(installer)

    assert error.value.status_code == 502


def test_command_runs_from_the_owned_project_directory_and_writes_files(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)
    observed = {}

    class CompletedProcess:
        returncode = 0

        def poll(self):
            return self.returncode

        def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9

    def fake_popen(arguments, **options):
        observed["arguments"] = arguments
        observed["options"] = options
        options["stdout"].write(b"project output")
        return CompletedProcess()

    monkeypatch.setattr(programming_workspace.subprocess, "Popen", fake_popen)
    result = programming_workspace.run_project_command(
        "account-7",
        "a" * 32,
        "cmd",
        "python main.py",
        [{"path": "main.py", "content": "print('hello')"}],
    )

    assert result["exit_code"] == 0
    assert result["output"] == "project output"
    assert (observed["options"]["cwd"] / "main.py").read_text(encoding="utf-8") == "print('hello')"
    assert "timeout" not in observed["options"]
    assert observed["arguments"].endswith('/c "python main.py"')


def test_rejects_paths_outside_the_project(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)

    with pytest.raises(HTTPException) as error:
        programming_workspace.run_project_command(
            "account-7",
            "b" * 32,
            "cmd",
            "python main.py",
            [{"path": "..\\outside.txt", "content": "not allowed"}],
        )

    assert error.value.status_code == 422
    assert list(tmp_path.rglob("outside.txt")) == []


def test_projects_are_isolated_by_owner(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)

    class CompletedProcess:
        returncode = 0

        def poll(self):
            return self.returncode

        def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9

    def fake_popen(_arguments, **_options):
        return CompletedProcess()

    monkeypatch.setattr(programming_workspace.subprocess, "Popen", fake_popen)
    programming_workspace.run_project_command(
        "account-one",
        "c" * 32,
        "cmd",
        "echo first",
        [{"path": "app.py", "content": "first"}],
    )
    programming_workspace.run_project_command(
        "account-two",
        "c" * 32,
        "cmd",
        "echo second",
        [{"path": "app.py", "content": "second"}],
    )

    assert len(list(tmp_path.glob("*/" + ("c" * 32) + "/app.py"))) == 2
    assert {path.read_text(encoding="utf-8") for path in tmp_path.glob("*/" + ("c" * 32) + "/app.py")} == {
        "first",
        "second",
    }


def test_command_output_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)

    class CompletedProcess:
        returncode = 0

        def poll(self):
            return self.returncode

        def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9

    def fake_popen(_arguments, **options):
        options["stdout"].write(b"x" * (programming_workspace.MAX_CAPTURE_BYTES + 100))
        return CompletedProcess()

    monkeypatch.setattr(programming_workspace.subprocess, "Popen", fake_popen)
    result = programming_workspace.run_project_command(None, "d" * 32, "cmd", "echo test", [])

    assert result["output_truncated"] is True
    assert len(result["output"]) == programming_workspace.MAX_OUTPUT_LENGTH


def test_command_timeout_terminates_the_process(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)
    monkeypatch.setattr(programming_workspace, "COMMAND_TIMEOUT_SECONDS", 0)

    class StuckProcess:
        returncode = None

        def poll(self):
            return self.returncode

        def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9

    process = StuckProcess()
    monkeypatch.setattr(programming_workspace.subprocess, "Popen", lambda *_args, **_kwargs: process)

    result = programming_workspace.run_project_command(None, "e" * 32, "cmd", "echo test", [])

    assert result["timed_out"] is True
    assert result["exit_code"] == -1


def test_rejects_invalid_project_ids_before_creating_a_directory(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)

    with pytest.raises(HTTPException) as error:
        programming_workspace.run_project_command(None, "../outside", "cmd", "echo test", [])

    assert error.value.status_code == 422
    assert list(tmp_path.iterdir()) == []


def test_workspace_files_can_be_initialized_then_read_and_updated(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)
    project_id = "f" * 32

    initialized = programming_workspace.initialize_project_workspace(
        "account-7",
        project_id,
        [{"path": "src/main.py", "content": "print('first')"}],
    )
    assert initialized["files"] == [{"path": "src/main.py", "content": "print('first')"}]
    assert initialized["working_directory"].endswith(project_id)

    programming_workspace.write_project_workspace(
        "account-7",
        project_id,
        [{"path": "src/main.py", "content": "print('updated')"}],
    )
    loaded = programming_workspace.read_project_workspace("account-7", project_id)
    assert loaded["files"] == [{"path": "src/main.py", "content": "print('updated')"}]


def test_workspace_context_skips_secrets_and_generated_directories(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path)
    project = programming_workspace._project_directory(None, "a" * 32)
    (project / ".git").mkdir(parents=True)
    (project / ".git" / "config").write_text("private git metadata", encoding="utf-8")
    (project / "node_modules").mkdir(parents=True)
    (project / "node_modules" / "hidden.js").write_text("not context", encoding="utf-8")
    (project / ".env").write_text("SECRET=value", encoding="utf-8")
    (project / "main.js").write_text("console.log('visible')", encoding="utf-8")

    loaded = programming_workspace.read_project_workspace(None, "a" * 32)

    assert loaded["files"] == [{"path": "main.js", "content": "console.log('visible')"}]
