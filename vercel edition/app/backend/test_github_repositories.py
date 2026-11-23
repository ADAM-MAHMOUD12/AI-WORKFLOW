import base64
import subprocess

import pytest
from fastapi import HTTPException

import programming_workspace


def test_clone_github_repository_uses_transient_credentials_and_clean_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path / "workspaces")
    access_token = "private-github-access-token"
    expected_header = "AUTHORIZATION: basic " + base64.b64encode(
        f"x-access-token:{access_token}".encode("utf-8")
    ).decode("ascii")

    def fake_run(command, **kwargs):
        assert command == [
            "git", "clone", "--depth=1", "--single-branch", "--no-tags", "--progress",
            "https://github.com/acme/demo.git",
            str(tmp_path / "workspaces" / programming_workspace._owner_directory("user-1").name /
                "0123456789abcdef0123456789abcdef"),
        ]
        assert access_token not in " ".join(command)
        assert kwargs["env"]["GIT_CONFIG_VALUE_0"] == expected_header
        assert kwargs["env"]["GIT_CONFIG_VALUE_1"] == ""
        assert kwargs["env"]["GIT_CONFIG_VALUE_2"] == "never"
        destination = programming_workspace.Path(command[-1])
        destination.mkdir(parents=True)
        (destination / ".git").mkdir()
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(programming_workspace.subprocess, "run", fake_run)

    result = programming_workspace.clone_github_repository_workspace(
        "user-1",
        "0123456789abcdef0123456789abcdef",
        "acme/demo",
        access_token,
    )

    assert result["project_id"] == "0123456789abcdef0123456789abcdef"
    assert result["name"] == "acme/demo"
    assert programming_workspace.Path(result["working_directory"]).is_dir()


def test_failed_github_clone_removes_partial_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path / "workspaces")
    project_id = "0123456789abcdef0123456789abcdef"

    def failed_run(command, **kwargs):
        destination = programming_workspace.Path(command[-1])
        destination.mkdir(parents=True)
        return subprocess.CompletedProcess(command, 128, "", "private failure output")

    monkeypatch.setattr(programming_workspace.subprocess, "run", failed_run)

    with pytest.raises(HTTPException) as error:
        programming_workspace.clone_github_repository_workspace(
            "user-1", project_id, "acme/demo", "private-github-access-token"
        )

    assert error.value.status_code == 502
    assert not programming_workspace._project_directory("user-1", project_id).exists()


def test_clone_github_repository_rejects_non_github_names(tmp_path, monkeypatch):
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", tmp_path / "workspaces")

    with pytest.raises(HTTPException) as error:
        programming_workspace.clone_github_repository_workspace(
            "user-1", "0123456789abcdef0123456789abcdef", "../outside", "token"
        )

    assert error.value.status_code == 422


def create_test_repository(tmp_path, monkeypatch):
    root = tmp_path / "workspaces"
    monkeypatch.setattr(programming_workspace, "WORKSPACE_ROOT", root)
    project_id = "0123456789abcdef0123456789abcdef"
    project = programming_workspace._project_directory("user-1", project_id)
    project.mkdir(parents=True)

    def run_git(*arguments):
        return subprocess.run(
            ["git", "-C", str(project), *arguments],
            check=True,
            capture_output=True,
            text=True,
        )

    run_git("init", "-b", "main")
    run_git("config", "user.name", "Test User")
    run_git("config", "user.email", "test@example.com")
    run_git("remote", "add", "origin", "https://github.com/acme/demo.git")
    (project / "tracked.txt").write_text("before\n", encoding="utf-8")
    run_git("add", "--", "tracked.txt")
    run_git("commit", "-m", "initial")
    return project_id, project, run_git


def test_git_status_stage_commit_and_push_use_expected_files(tmp_path, monkeypatch):
    project_id, project, run_git = create_test_repository(tmp_path, monkeypatch)
    (project / "tracked.txt").write_text("after\n", encoding="utf-8")
    (project / "new file.txt").write_text("new\n", encoding="utf-8")

    before = programming_workspace.git_repository_status("user-1", project_id)
    assert before["repository"] == "acme/demo"
    assert before["branch"] == "main"
    assert {item["path"] for item in before["files"]} == {"tracked.txt", "new file.txt"}

    staged = programming_workspace.git_stage_repository_files(
        "user-1", project_id, ["tracked.txt", "new file.txt"], True
    )
    assert all(item["staged"] for item in staged["files"])
    unstaged = programming_workspace.git_stage_repository_files(
        "user-1", project_id, ["new file.txt"], False
    )
    new_file = next(item for item in unstaged["files"] if item["path"] == "new file.txt")
    assert new_file["untracked"] is True
    programming_workspace.git_stage_repository_files("user-1", project_id, ["new file.txt"], True)

    committed = programming_workspace.git_commit_staged_changes(
        "user-1",
        project_id,
        "Update repository",
        "Add a new file and edit the existing one.",
        "TaskFlow Test",
        "taskflow-test@users.noreply.github.com",
    )
    assert committed["repository"] == "acme/demo"
    assert committed["commit"]
    assert committed["status"]["files"] == []
    assert run_git("log", "-1", "--pretty=%B").stdout.strip() == (
        "Update repository\n\nAdd a new file and edit the existing one."
    )

    run_git("update-ref", "refs/remotes/origin/main", "HEAD")
    run_git("branch", "--set-upstream-to=origin/main", "main")
    pushes = []
    original_run = subprocess.run

    def fake_push(command, *args, **kwargs):
        if command[0] == "git" and "push" in command:
            pushes.append((command, kwargs["env"], kwargs["timeout"]))
            return subprocess.CompletedProcess(command, 0, b"", b"")
        return original_run(command, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", fake_push)
    pushed = programming_workspace.git_push_repository("user-1", project_id, "private-token")
    assert pushed["repository"] == "acme/demo"
    assert len(pushes) == 1
    push_command, push_environment, push_timeout = pushes[0]
    assert push_command[-1] == "push"
    assert "private-token" not in " ".join(push_command)
    assert push_environment["GIT_CONFIG_VALUE_0"] == "AUTHORIZATION: basic " + base64.b64encode(
        b"x-access-token:private-token"
    ).decode("ascii")
    assert push_timeout == programming_workspace.GIT_PUSH_TIMEOUT_SECONDS


def test_git_commit_requires_staged_changes_and_valid_author(tmp_path, monkeypatch):
    project_id, project, _run_git = create_test_repository(tmp_path, monkeypatch)
    (project / "tracked.txt").write_text("changed\n", encoding="utf-8")

    with pytest.raises(HTTPException) as error:
        programming_workspace.git_commit_staged_changes(
            "user-1", project_id, "Change", "", "Test", "invalid email"
        )
    assert error.value.status_code == 422

    with pytest.raises(HTTPException) as error:
        programming_workspace.git_commit_staged_changes(
            "user-1", project_id, "Change", "", "Test", "test@example.com"
        )
    assert error.value.status_code == 409


def test_git_repository_rejects_non_github_origin(tmp_path, monkeypatch):
    project_id, _project, run_git = create_test_repository(tmp_path, monkeypatch)
    run_git("remote", "set-url", "origin", "https://example.com/acme/demo.git")

    with pytest.raises(HTTPException) as error:
        programming_workspace.git_repository_status("user-1", project_id)

    assert error.value.status_code == 403
