import pytest
from fastapi import HTTPException

import programming_workspace


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
