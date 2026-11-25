"""Discovery and credential-safe environment for the installed official Claude Code client."""
import os
import re
import shutil
import subprocess
from pathlib import Path

def candidate_binaries(home=None):
    home=home or Path.home()
    candidates=[Path(p) for p in (shutil.which('claude'),'/opt/homebrew/bin/claude','/usr/local/bin/claude',str(home/'.local/bin/claude')) if p]
    if os.name=='nt':  # native installer and npm global installs
        appdata=Path(os.getenv('APPDATA') or home/'AppData/Roaming')
        candidates.extend([home/'.local/bin/claude.exe',appdata/'npm/claude.cmd'])
    # The official IDE extension carries its own native client; no separate CLI install is required.
    for directory in ('.vscode/extensions','.vscode-insiders/extensions','.cursor/extensions'):
        extensions=list((home/directory).glob('anthropic.claude-code-*'))
        extensions.sort(key=lambda p:tuple(int(v) for v in re.findall(r'\d+',p.name)),reverse=True)
        candidates.extend(p/'resources/native-binary'/('claude.exe' if os.name=='nt' else 'claude') for p in extensions)
    return list(dict.fromkeys(candidates))


def find_claude(clean):
    for path in candidate_binaries():
        if not path.is_file() or not os.access(path,os.X_OK):continue
        try:
            result=subprocess.run([str(path),'--version'],capture_output=True,text=True,env=clean,timeout=8)
        except (OSError,subprocess.TimeoutExpired):continue
        if result.returncode==0 and 'Claude Code' in result.stdout:return str(path)
    return None


def clean_environment():
    clean=os.environ.copy()
    for key in ('APP_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'):
        clean.pop(key,None)
    return clean
