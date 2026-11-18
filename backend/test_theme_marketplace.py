import json
import subprocess

import pytest
from fastapi import HTTPException

from main import publish_marketplace_theme


THEME = json.dumps({
    "name": "Sample Theme",
    "glass": True,
    "colors": {"editorBackground": "#171a21", "buttonHoverBackground": "#222831"},
    "sizes": {"uiFontSize": 13, "editorFontSize": 14, "cornerRadius": 8},
    "fonts": {"ui": "inter", "editor": "cascadia-code"},
    "glassSettings": {"blur": 18, "opacity": 68, "saturation": 125, "tint": "#9b87ef"},
    "buttonSettings": {"style": "glass", "radius": 10, "height": 42},
    "motion": {"preset": "smooth", "duration": 220, "hoverLift": 2},
    "controls": ["glassEffect", "glassBlur", "uiFontFamily", "buttonHoverBackground", "motionPreset"],
}).encode("utf-8")


def test_publish_theme_commits_creator_readme_and_preview_to_git_remote(tmp_path):
    remote = tmp_path / "theme-store.git"
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)

    result = publish_marketplace_theme(
        "sample-theme",
        "Sample Theme",
        "Theme Author",
        "A test theme",
        THEME,
        "# Sample Theme\n\nAuthor: Theme Author\n",
        b"\x89PNG\r\n\x1a\npreview",
        "png",
        str(remote),
    )

    assert result["published"] is True
    clone = tmp_path / "published"
    subprocess.run(["git", "clone", "--branch", "main", str(remote), str(clone)], check=True, capture_output=True)
    catalog = json.loads((clone / "catalog.json").read_text(encoding="utf-8"))
    item = catalog["themes"][0]
    assert item["author"] == "Theme Author"
    assert item["readme"] == "themes/sample-theme/README.md"
    assert item["preview"] == "themes/sample-theme/preview.png"
    assert (clone / "themes/sample-theme.json").read_bytes() == THEME
    assert (clone / item["readme"]).exists()
    assert (clone / item["preview"]).read_bytes().startswith(b"\x89PNG")


def test_publish_theme_rejects_duplicate_ids(tmp_path):
    remote = tmp_path / "theme-store.git"
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    arguments = (
        "same-theme",
        "Sample Theme",
        "Theme Author",
        "A test theme",
        THEME,
        "# Sample Theme\n",
        None,
        None,
        str(remote),
    )
    publish_marketplace_theme(*arguments)

    with pytest.raises(HTTPException) as error:
        publish_marketplace_theme(*arguments)

    assert error.value.status_code == 409


@pytest.mark.parametrize("sizes", [
    {"unknownSize": 13},
    {"editorFontSize": 25},
    {"cornerRadius": True},
    [],
])
def test_publish_theme_rejects_unsupported_or_out_of_range_sizes(tmp_path, sizes):
    theme = json.dumps({
        "name": "Sample Theme",
        "colors": {"editorBackground": "#171a21"},
        "sizes": sizes,
    }).encode("utf-8")

    with pytest.raises(HTTPException) as error:
        publish_marketplace_theme(
            "sample-theme",
            "Sample Theme",
            "Theme Author",
            "A test theme",
            theme,
            "# Sample Theme\n",
            None,
            None,
            str(tmp_path / "unused.git"),
        )

    assert error.value.status_code == 422


def test_publish_theme_rejects_unregistered_theme_fields(tmp_path):
    theme = json.dumps({
        "name": "Sample Theme",
        "colors": {"editorBackground": "#171a21"},
        "customCss": "body { display: none; }",
    }).encode("utf-8")

    with pytest.raises(HTTPException) as error:
        publish_marketplace_theme(
            "sample-theme",
            "Sample Theme",
            "Theme Author",
            "A test theme",
            theme,
            "# Sample Theme\n",
            None,
            None,
            str(tmp_path / "unused.git"),
        )

    assert error.value.status_code == 422


@pytest.mark.parametrize("field,value", [
    ("fonts", {"ui": "remote-font-url"}),
    ("fonts", {"terminal": "monospace"}),
    ("glassSettings", {"blur": 37}),
    ("glassSettings", {"tint": "url(https://example.invalid/x)"}),
    ("glassSettings", {"unknown": 10}),
    ("controls", ["customJavaScript"]),
    ("controls", ["glassBlur", "glassBlur"]),
    ("buttonSettings", {"radius": 25}),
    ("buttonSettings", {"style": "url(https://example.invalid/style)"}),
    ("buttonSettings", {"unknown": 10}),
    ("motion", {"preset": "custom-javascript"}),
    ("motion", {"duration": 501}),
    ("motion", {"hoverLift": True}),
    ("motion", {"unknown": "fade"}),
])
def test_publish_theme_rejects_unregistered_theme_settings(tmp_path, field, value):
    theme = json.dumps({
        "name": "Sample Theme",
        "colors": {},
        field: value,
    }).encode("utf-8")

    with pytest.raises(HTTPException) as error:
        publish_marketplace_theme(
            "sample-theme",
            "Sample Theme",
            "Theme Author",
            "A test theme",
            theme,
            "# Sample Theme\n",
            None,
            None,
            str(tmp_path / "unused.git"),
        )

    assert error.value.status_code == 422
