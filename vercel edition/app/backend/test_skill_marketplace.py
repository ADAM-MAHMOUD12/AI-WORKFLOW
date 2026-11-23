import asyncio

import pytest
from fastapi import HTTPException

import skill_marketplace


class FakeResponse:
    def __init__(self, status_code, payload=None, content=b""):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.text = content.decode("utf-8")

    def json(self):
        return self._payload


class FakeAsyncClient:
    responses = {}
    requests = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, params=None, headers=None):
        self.requests.append((url, params, headers))
        return self.responses[url]


def test_search_skills_normalizes_and_filters_public_results(monkeypatch):
    FakeAsyncClient.responses = {
        f"{skill_marketplace.SKILLS_SH_API}/search": FakeResponse(200, {
            "skills": [
                {"source": "anthropics/skills", "skillId": "frontend-design", "name": "frontend-design", "installs": 42, "isOfficial": True},
                {"source": "../private", "skillId": "not-safe", "name": "Not safe"},
                {"source": "anthropics/skills", "skillId": "frontend-design", "name": "duplicate"},
                {"source": "broken", "skillId": "missing-repo", "name": "Invalid source"},
            ]
        })
    }
    FakeAsyncClient.requests = []
    monkeypatch.setattr(skill_marketplace.httpx, "AsyncClient", FakeAsyncClient)

    result = asyncio.run(skill_marketplace.search_skills("  frontend design  "))

    assert result == [{
        "id": "anthropics/skills/frontend-design",
        "source": "anthropics/skills",
        "skill_id": "frontend-design",
        "name": "frontend-design",
        "installs": 42,
        "official": True,
    }]
    assert FakeAsyncClient.requests[0][1] == {"q": "frontend design", "limit": 30}


def test_validate_source_rejects_urls_and_path_traversal():
    for source in ("https://github.com/user/repo", "user/../repo", "user/repo/extra", "user repo"):
        with pytest.raises(HTTPException) as error:
            skill_marketplace.validate_source(source)
        assert error.value.status_code == 422


def test_find_skill_file_path_prefers_exact_skill_folder():
    tree = [
        {"path": "skills/react/SKILL.md"},
        {"path": "skills/frontend-design/SKILL.md"},
        {"path": "docs/SKILL.md"},
    ]

    assert skill_marketplace.find_skill_file_path(tree, "frontend-design") == "skills/frontend-design/SKILL.md"


def test_find_skill_file_path_supports_prefixed_skill_names_and_rejects_ambiguity():
    tree = [{"path": "skills/react-best-practices/SKILL.md"}]
    assert skill_marketplace.find_skill_file_path(tree, "vercel-react-best-practices") == "skills/react-best-practices/SKILL.md"

    ambiguous = [
        {"path": "first/frontend-design/SKILL.md"},
        {"path": "second/frontend-design/SKILL.md"},
    ]
    with pytest.raises(HTTPException) as error:
        skill_marketplace.find_skill_file_path(ambiguous, "frontend-design")
    assert error.value.status_code == 404


def test_fetch_skill_reads_only_the_requested_skill_file(monkeypatch):
    raw_content = (
        b"---\nname: frontend-design\ndescription: Design useful interfaces.\n---\n"
        b"# Instructions\nUse the existing design system.\n"
    )
    repository_url = f"{skill_marketplace.GITHUB_API}/repos/anthropics/skills"
    tree_url = f"{skill_marketplace.GITHUB_API}/repos/anthropics/skills/git/trees/main?recursive=1"
    raw_url = "https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md"
    FakeAsyncClient.responses = {
        repository_url: FakeResponse(200, {"default_branch": "main"}),
        tree_url: FakeResponse(200, {
            "truncated": False,
            "tree": [{"path": "skills/frontend-design/SKILL.md"}],
        }),
        raw_url: FakeResponse(200, content=raw_content),
    }
    FakeAsyncClient.requests = []
    monkeypatch.setattr(skill_marketplace.httpx, "AsyncClient", FakeAsyncClient)

    result = asyncio.run(skill_marketplace.fetch_skill("anthropics/skills", "frontend-design"))

    assert result["content"] == raw_content.decode("utf-8")
    assert result["source_url"] == "https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md"
    assert FakeAsyncClient.requests[-1][0] == raw_url


def test_fetch_skill_rejects_invalid_skill_markdown(monkeypatch):
    repository_url = f"{skill_marketplace.GITHUB_API}/repos/example/skills"
    tree_url = f"{skill_marketplace.GITHUB_API}/repos/example/skills/git/trees/main?recursive=1"
    raw_url = "https://raw.githubusercontent.com/example/skills/main/skills/example-skill/SKILL.md"
    FakeAsyncClient.responses = {
        repository_url: FakeResponse(200, {"default_branch": "main"}),
        tree_url: FakeResponse(200, {
            "truncated": False,
            "tree": [{"path": "skills/example-skill/SKILL.md"}],
        }),
        raw_url: FakeResponse(200, content=b"not a skill"),
    }
    monkeypatch.setattr(skill_marketplace.httpx, "AsyncClient", FakeAsyncClient)

    with pytest.raises(HTTPException) as error:
        asyncio.run(skill_marketplace.fetch_skill("example/skills", "example-skill"))
    assert error.value.status_code == 422
