import importlib.util
from pathlib import Path
from types import SimpleNamespace

from aesthetic_lab import claude_client as launcher


def test_missing_cli_and_broken_link_fall_back_to_official_extension(tmp_path,monkeypatch):
    missing=tmp_path/'claude'
    missing.symlink_to(tmp_path/'missing-after-update')
    binary=tmp_path/'.vscode/extensions/anthropic.claude-code-2.1.314-darwin-arm64/resources/native-binary/claude'
    binary.parent.mkdir(parents=True);binary.write_text('test');binary.chmod(0o755)
    monkeypatch.setattr(launcher,'candidate_binaries',lambda:[missing,binary])
    calls=[]
    def run(args,**kwargs):
        calls.append(args);return SimpleNamespace(returncode=0,stdout='2.1.314 (Claude Code)')
    monkeypatch.setattr(launcher.subprocess,'run',run)
    assert launcher.find_claude({})==str(binary)
    assert calls==[[str(binary),'--version']]


def test_unrunnable_cli_does_not_prevent_extension_fallback(tmp_path,monkeypatch):
    bad=tmp_path/'wrong-platform';good=tmp_path/'native'
    for p in (bad,good):p.write_text('test');p.chmod(0o755)
    monkeypatch.setattr(launcher,'candidate_binaries',lambda:[bad,good])
    def run(args,**kwargs):
        if args[0]==str(bad):raise OSError('Exec format error')
        return SimpleNamespace(returncode=0,stdout='2.1.314 (Claude Code)')
    monkeypatch.setattr(launcher.subprocess,'run',run)
    assert launcher.find_claude({})==str(good)


def test_extension_versions_are_ordered_numerically(tmp_path,monkeypatch):
    for version in ('2.1.9','2.1.10'):
        (tmp_path/f'.vscode/extensions/anthropic.claude-code-{version}-darwin-arm64').mkdir(parents=True)
    monkeypatch.setattr(launcher.shutil,'which',lambda _:None)
    found=[p for p in launcher.candidate_binaries(tmp_path) if '.vscode/' in str(p)]
    assert '2.1.10' in str(found[0]) and '2.1.9' in str(found[1])
