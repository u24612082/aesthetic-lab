#!/usr/bin/env python3
"""Register the local MCP server in this project's Claude Code configuration."""
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
path=ROOT/'.mcp.json'
config=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
config.setdefault('mcpServers',{})['aesthetic-lab']={'type':'stdio','command':sys.executable,
    'args':[str(ROOT/'scripts/run_mcp.py')],'env':{'COACH_PROVIDER':'subscription'}}
path.write_text(json.dumps(config,indent=2)+'\n',encoding='utf-8')
path.chmod(0o600)
print('Aesthetic Lab MCP configured for this workspace. Open Claude Code here and approve the project server when prompted.')
