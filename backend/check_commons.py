import asyncio
import httpx

async def main():
    headers = {
        "User-Agent": "AI-TaskFlow/1.0 (local development)",
        "Accept": "application/json,*/*",
    }
    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": "logo",
        "gsrnamespace": "6",
        "gsrlimit": "2",
        "prop": "imageinfo",
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True, trust_env=False) as client:
            response = await client.get("https://commons.wikimedia.org/w/api.php", params=params, headers=headers)
            print(response.status_code)
            print(response.text[:300])
    except Exception as exc:
        print(type(exc).__name__, repr(exc))

asyncio.run(main())
