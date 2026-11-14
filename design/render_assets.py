import os
import re
import subprocess
from pathlib import Path

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
DESIGN_DIR = Path(r"C:\Users\csgo\Desktop\AI-TaskFlow\design")
HTML_FILE = DESIGN_DIR / "AI-TaskFlow-Presentation-12Pages.html"
OUTPUT_DIR = DESIGN_DIR / "presentation_jpg"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Read master HTML presentation
with open(HTML_FILE, "r", encoding="utf-8") as f:
    full_html = f.read()

# Extract styles and fonts from head
head_match = re.search(r"<head>(.*?)</head>", full_html, re.DOTALL | re.IGNORECASE)
head_content = head_match.group(1) if head_match else ""

# Extract individual slide divs
slide_divs = re.findall(r'(<div class="slide-page" id="slide-\d+">.*?</div>\s*</div>)', full_html, re.DOTALL)
if not slide_divs:
    # Try alternate split
    slides_raw = full_html.split('<div class="slide-page"')
    slide_divs = []
    for s in slides_raw[1:]:
        slide_divs.append('<div class="slide-page"' + s.split('<!-- SLIDE')[0].split('</body>')[0])

print(f"Found {len(slide_divs)} slides. Processing...")

# Template for standalone slide
standalone_template = """<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
{head}
<style>
  body {{
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    width: 1920px !important;
    height: 1080px !important;
    overflow: hidden !important;
  }}
  .slide-page {{
    width: 1920px !important;
    height: 1080px !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    padding: 60px 80px 45px 80px !important;
  }}
  .slide-title {{
    font-size: 40px !important;
  }}
  .slide-num-pill {{
    font-size: 20px !important;
    padding: 6px 18px !important;
  }}
  .slide-body {{
    font-size: 24px !important;
    line-height: 1.8 !important;
  }}
  .info-card h3 {{
    font-size: 26px !important;
  }}
  .info-card p, .info-card li {{
    font-size: 20px !important;
    line-height: 1.7 !important;
  }}
  .stat-number {{
    font-size: 56px !important;
  }}
  .stat-desc {{
    font-size: 20px !important;
  }}
  .slide-footer {{
    font-size: 16px !important;
  }}
</style>
</head>
<body>
{slide}
</body>
</html>
"""

temp_dir = DESIGN_DIR / "temp_slides"
temp_dir.mkdir(exist_ok=True)

for i, slide_html in enumerate(slide_divs, start=1):
    temp_html = temp_dir / f"slide_{i:02d}.html"
    jpg_output = OUTPUT_DIR / f"Slide_{i:02d}.jpg"
    
    clean_slide = slide_html.strip()
    # Ensure slide-page wraps correctly
    if not clean_slide.startswith("<div class=\"slide-page\""):
        clean_slide = '<div class="slide-page" id="slide-' + str(i) + '">' + clean_slide
    
    html_page = standalone_template.format(head=head_content, slide=clean_slide)
    with open(temp_html, "w", encoding="utf-8") as f:
        f.write(html_page)
        
    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--force-device-scale-factor=1",
        "--window-size=1920,1080",
        f"--screenshot={str(jpg_output)}",
        f"file:///{str(temp_html).replace(os.sep, '/')}"
    ]
    subprocess.run(cmd, capture_output=True)
    if jpg_output.exists():
        print(f"Saved: {jpg_output.name} ({jpg_output.stat().st_size // 1024} KB)")

# Cleanup temp html files
for p in temp_dir.glob("*.html"):
    p.unlink()
temp_dir.rmdir()

# Render Poster High-Res Image
poster_html = DESIGN_DIR / "ISEF_Display_Board_140x120.html"
poster_img = DESIGN_DIR / "ISEF_Display_Board_140x120_HighRes.png"
print("Rendering Master Poster Image...")
poster_cmd = [
    CHROME_PATH,
    "--headless=new",
    "--disable-gpu",
    "--window-size=2800,2400",
    f"--screenshot={str(poster_img)}",
    f"file:///{str(poster_html).replace(os.sep, '/')}"
]
subprocess.run(poster_cmd, capture_output=True)
if poster_img.exists():
    print(f"Master Poster Rendered: {poster_img.name} ({poster_img.stat().st_size // 1024} KB)")
