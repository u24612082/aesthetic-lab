#!/bin/zsh
set -eu
cd -- "${0:A:h}"
if ! python3 scripts/prepare_ios.py --open; then
  print '\nSee docs/iphone-setup.md for the remaining installation steps.'
  print 'Press Return to close this window.'
  read -r
fi
