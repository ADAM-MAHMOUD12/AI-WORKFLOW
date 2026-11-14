#define AppName "OPENFILM-AI TASKFLOW EDITION"
#define AppVersion "1.0.0"
#define AppPublisher "ADAM MAHMOUD ABDELALIM"
#define AppExeName "OPENFILM-AI TASKFLOW EDITION.exe"
#define PayloadDir GetEnv("TASKFLOW_INSTALLER_PAYLOAD")

[Setup]
AppId={{960A6DEC-14E1-4BD8-98A9-5F5E954C38D7}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppCopyright=Copyright 2026 ADAM MAHMOUD ABDELALIM
DefaultDirName={localappdata}\AI TaskFlow
DefaultGroupName={#AppName}
OutputDir=output
OutputBaseFilename=OPENFILM-AI-TASKFLOW-Setup
SetupIconFile=taskflow.ico
UninstallDisplayIcon={app}\{#AppExeName}
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
Compression=lzma2
SolidCompression=yes
DisableProgramGroupPage=yes
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} installer
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"; LicenseFile: "privacy-en.txt"
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"; LicenseFile: "privacy-ar.txt"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".git\*;backend\data\*;data\*;desktop.ini;.env;*.pyc;*.map;*.tsbuildinfo"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-prerequisites.ps1"""; StatusMsg: "Installing required runtimes and application libraries..."; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: postinstall nowait skipifsilent
