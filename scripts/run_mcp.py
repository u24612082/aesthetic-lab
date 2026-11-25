#!/usr/bin/env python3
"""Absolute-path stdio entry point; independent of the Claude client's working directory."""
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from aesthetic_lab.mcp_server import main

if __name__=='__main__':main()
