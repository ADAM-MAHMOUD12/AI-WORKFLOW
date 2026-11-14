import subprocess
from pathlib import Path

html_path = Path(r"C:\Users\csgo\Desktop\AI-TaskFlow\design\ISEF_Display_Board_140x120_Final.html")
pdf_path = Path(r"C:\Users\csgo\Desktop\AI-TaskFlow\design\AI-TaskFlow-ISEF-Poster-140x120.pdf")

url = "file:///" + str(html_path.resolve()).replace("\\", "/")

cmd = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    f"--print-to-pdf={str(pdf_path)}",
    url
]

res = subprocess.run(cmd, capture_output=True, text=True)
print("Returncode:", res.returncode)
if pdf_path.exists():
    print(f"Generated PDF successfully: {pdf_path.name} ({pdf_path.stat().st_size // 1024} KB)")
    with open(pdf_path, "rb") as f:
        content = f.read()
        import re
        boxes = re.findall(rb"/MediaBox\s*\[\s*([\d\.\s]+)\s*\]", content)
        print("MediaBox dimensions:", boxes)
else:
    print("PDF generation failed.")
