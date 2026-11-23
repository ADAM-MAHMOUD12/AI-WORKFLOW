import os
import subprocess
import sys
from pathlib import Path


install_root = Path(sys.executable).resolve().parent
launcher = install_root / "start-all.bat"
if not launcher.is_file():
    message = (
        "This launcher needs the application files installed beside it.\n\n"
        "Please run OPENFILM-AI-TASKFLOW-Setup.exe to install and launch AI TaskFlow."
    )
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "OPENFILM-AI TASKFLOW EDITION", 0x10)
    else:
        print(message, file=sys.stderr)
    raise SystemExit(1)

subprocess.Popen(
    [os.environ.get("COMSPEC", "cmd.exe"), "/c", str(launcher)],
    cwd=install_root,
    creationflags=subprocess.CREATE_NEW_CONSOLE,
)
