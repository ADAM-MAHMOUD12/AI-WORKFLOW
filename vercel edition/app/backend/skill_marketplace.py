from __future__ import annotations

import re
from urllib.parse import quote

import httpx
from fastapi import HTTPException

SKILLS_SH_API = "https://www.skills.sh/api"
GITHUB_API = "https://api.github.com"
MAX_SKILL_BYTES = 1_000_000
SOURCE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
SKILL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")


def validate_source(source: str) -> str:
    if not SOURCE_RE.fullmatch(source):
        raise HTTPException(status_code=422, detail="Invalid public skill repository.")
    return source


async def search_skills(query: str) -> list[dict[str, object]]:
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = await client.get(
                f"{SKILLS_SH_API}/search",
                params={"q": query.strip()[:100], "limit": 30},
                headers={"Accept": "application/json"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach the public skills.sh library.") from exc

    if response.status_code == 429:
        raise HTTPException(status_code=503, detail="The public skills.sh library is rate-limiting searches.")
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="The public skills.sh library search failed.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="The public skills.sh library returned invalid JSON.") from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("skills"), list):
        raise HTTPException(status_code=502, detail="The public skills.sh library returned an invalid result.")

    return normalize_skills(payload["skills"])


async def popular_skills() -> list[dict[str, object]]:
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = await client.get(
                f"{SKILLS_SH_API}/skills/all-time/0",
                headers={"Accept": "application/json"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach the public skills.sh library.") from exc

    if response.status_code == 429:
        raise HTTPException(status_code=503, detail="The public skills.sh library is rate-limiting requests.")
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not load popular skills from skills.sh.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="The public skills.sh library returned invalid JSON.") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("skills"), list):
        raise HTTPException(status_code=502, detail="The public skills.sh library returned an invalid result.")
    return normalize_skills(payload["skills"])


def normalize_skills(items: list[object]) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        source = item.get("source")
        skill_id = item.get("skillId")
        name = item.get("name")
        if not isinstance(source, str) or not SOURCE_RE.fullmatch(source):
            continue
        if not isinstance(skill_id, str) or not SKILL_ID_RE.fullmatch(skill_id):
            continue
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            continue
        result_id = f"{source}/{skill_id}"
        if result_id in seen:
            continue
        seen.add(result_id)
        installs = item.get("installs")
        results.append({
            "id": result_id,
            "source": source,
            "skill_id": skill_id,
            "name": name,
            "installs": installs if isinstance(installs, int) and not isinstance(installs, bool) and installs >= 0 else 0,
            "official": item.get("isOfficial") is True,
        })
    return results[:30]


def find_skill_file_path(tree: object, skill_id: str) -> str:
    if not isinstance(tree, list):
        raise HTTPException(status_code=502, detail="GitHub returned an invalid repository tree.")

    skill_files = [
        item["path"]
        for item in tree
        if isinstance(item, dict)
        and isinstance(item.get("path"), str)
        and item["path"].lower().endswith("skill.md")
        and "/" in item["path"]
        and ".." not in item["path"].split("/")
    ]
    exact_matches = [
        path for path in skill_files
        if path.rsplit("/", 2)[-2].casefold() == skill_id.casefold()
    ]
    matches = exact_matches or [
        path for path in skill_files
        if skill_id.casefold().endswith(path.rsplit("/", 2)[-2].casefold())
    ]
    if len(matches) != 1:
        raise HTTPException(
            status_code=404,
            detail="Could not uniquely locate this skill's SKILL.md in its public source repository.",
        )
    return matches[0]


async def fetch_skill(source: str, skill_id: str) -> dict[str, str]:
    validate_source(source)
    if not SKILL_ID_RE.fullmatch(skill_id):
        raise HTTPException(status_code=422, detail="Invalid public skill ID.")

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "AI-TaskFlow-Skill-Library",
    }
    repository_url = f"{GITHUB_API}/repos/{source}"
    timeout = httpx.Timeout(20.0, connect=6.0)
    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            repository_response = await client.get(repository_url, headers=headers)
            if repository_response.status_code == 404:
                raise HTTPException(status_code=404, detail="The public skill source repository was not found.")
            if repository_response.status_code == 403:
                raise HTTPException(status_code=503, detail="GitHub API rate limit reached. Try again later.")
            if repository_response.status_code != 200:
                raise HTTPException(status_code=502, detail="Could not read the public skill source repository.")
            repository = repository_response.json()
            default_branch = repository.get("default_branch") if isinstance(repository, dict) else None
            if not isinstance(default_branch, str) or not default_branch:
                raise HTTPException(status_code=502, detail="GitHub returned no default branch for this skill.")

            tree_url = f"{GITHUB_API}/repos/{source}/git/trees/{quote(default_branch, safe='')}?recursive=1"
            tree_response = await client.get(tree_url, headers=headers)
            if tree_response.status_code == 403:
                raise HTTPException(status_code=503, detail="GitHub API rate limit reached. Try again later.")
            if tree_response.status_code != 200:
                raise HTTPException(status_code=502, detail="Could not locate the skill in its public repository.")
            if len(tree_response.content) > 15_000_000:
                raise HTTPException(status_code=413, detail="The skill repository is too large to browse safely.")
            tree_payload = tree_response.json()
            if isinstance(tree_payload, dict) and tree_payload.get("truncated") is True:
                raise HTTPException(status_code=413, detail="The skill repository tree is too large to search safely.")
            tree = tree_payload.get("tree") if isinstance(tree_payload, dict) else None
            skill_path = find_skill_file_path(tree, skill_id)

            raw_url = (
                f"https://raw.githubusercontent.com/{source}/"
                f"{quote(default_branch, safe='')}/{quote(skill_path, safe='/')}"
            )
            content_response = await client.get(raw_url, headers={"Accept": "text/plain"})
            if content_response.status_code != 200:
                raise HTTPException(status_code=502, detail="Could not download the public SKILL.md.")
            if len(content_response.content) > MAX_SKILL_BYTES:
                raise HTTPException(status_code=413, detail="The skill file exceeds the 1 MB import limit.")
            content = content_response.text
    except HTTPException:
        raise
    except (httpx.RequestError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Could not download the public skill. Try again later.") from exc

    if "\0" in content or not content.lstrip().startswith("---") or not re.search(
        r"(?m)^name:\s*['\"]?[A-Za-z0-9][A-Za-z0-9_.-]{0,99}['\"]?\s*$",
        content,
    ):
        raise HTTPException(status_code=422, detail="The source file is not a valid SKILL.md.")

    return {
        "content": content,
        "source": source,
        "skill_id": skill_id,
        "source_url": f"https://github.com/{source}/blob/{quote(default_branch, safe='')}/{quote(skill_path, safe='/')}",
    }
