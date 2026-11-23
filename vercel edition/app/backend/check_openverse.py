import httpx

response = httpx.get(
    "https://api.openverse.org/v1/images/",
    params={"q": "logo", "page_size": 2},
    headers={"User-Agent": "AI-TaskFlow/1.0"},
    timeout=12,
    trust_env=False,
)
print(response.status_code)
print(response.text[:300])
