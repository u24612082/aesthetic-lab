#!/usr/bin/env python3
"""Build a native Mac launcher; optionally install its icon on the Desktop."""
import argparse
import plistlib
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IDENTIFIER = 'local.aesthetic-lab.desktop'


def apple_string(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def owned_app(path):
    try:
        info = plistlib.loads((path / 'Contents/Info.plist').read_bytes())
        return info.get('CFBundleIdentifier') == IDENTIFIER and info.get('AestheticLabWorkspace') == str(ROOT)
    except (OSError, ValueError, plistlib.InvalidFileException):
        return False


def build():
    parent = ROOT / 'var/desktop'
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / 'Aesthetic Lab.app'
    if target.exists() and not owned_app(target):
        raise RuntimeError(f'Refusing to replace an unrecognized app: {target}')
    command = 'cd ' + shlex.quote(str(ROOT)) + ' && exec ' + shlex.join([
        str(ROOT / '.venv/bin/python'), str(ROOT / 'scripts/mac.py')])
    script = ('on run\ntry\ndo shell script ' + apple_string(command) + '\n'
              'on error errorMessage\ndisplay alert "Aesthetic Lab could not open" '
              'message errorMessage as critical buttons {"OK"} default button "OK"\n'
              'end try\nend run\n')
    with tempfile.TemporaryDirectory(prefix='desktop-build-', dir=parent) as temp:
        staging = Path(temp)
        app = staging / 'Aesthetic Lab.app'
        subprocess.run(['/usr/bin/osacompile', '-o', str(app), '-'], input=script, text=True, check=True)
        iconset = staging / 'AestheticLab.iconset'
        iconset.mkdir()
        source = ROOT / 'opengym/frontend/public/icon-512.png'
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                pixels = size * scale
                filename = f'icon_{size}x{size}' + ('@2x' if scale == 2 else '') + '.png'
                subprocess.run(['/usr/bin/sips', '-z', str(pixels), str(pixels), str(source),
                                '--out', str(iconset / filename)], check=True, capture_output=True)
        subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o',
                        str(app / 'Contents/Resources/AestheticLab.icns')], check=True)
        info_path = app / 'Contents/Info.plist'
        info = plistlib.loads(info_path.read_bytes())
        info.update(CFBundleIdentifier=IDENTIFIER, CFBundleName='Aesthetic Lab', CFBundleDisplayName='Aesthetic Lab',
                    CFBundleIconFile='AestheticLab', CFBundleShortVersionString='0.1.0', CFBundleVersion='1',
                    LSUIElement=True, NSHighResolutionCapable=True, AestheticLabWorkspace=str(ROOT))
        # osacompile ships a generic script icon in Assets.car and names it via CFBundleIconName,
        # which macOS prefers over CFBundleIconFile. Drop both so the dumbbell icon is shown.
        info.pop('CFBundleIconName', None)
        (app / 'Contents/Resources/Assets.car').unlink(missing_ok=True)
        info_path.write_bytes(plistlib.dumps(info))
        subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], check=True, capture_output=True)
        if target.exists():shutil.rmtree(target)
        shutil.copytree(app, target)
    return target


def install(app):
    desktop = Path.home() / 'Desktop'
    target = desktop / 'Aesthetic Lab.app'
    if target.exists() and not owned_app(target):
        raise RuntimeError('An unrelated Aesthetic Lab.app already exists on your Desktop. It has been left untouched.')
    with tempfile.TemporaryDirectory(prefix='.aesthetic-lab-install-', dir=desktop) as temp:
        staged = Path(temp) / target.name
        shutil.copytree(app, staged)
        if target.exists():shutil.rmtree(target)
        staged.rename(target)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Copy the finished native launcher to your Desktop')
    args = parser.parse_args()
    if sys.platform != 'darwin':raise SystemExit('This launcher is for macOS.')
    try:
        app = build()
        if args.install:app = install(app)
        print(('Desktop icon installed: ' if args.install else 'Launcher built: ') + str(app))
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc)) from None


if __name__ == '__main__':main()
