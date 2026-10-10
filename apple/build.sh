#!/bin/zsh
# Build Dynamo.app with the Command Line Tools only (no Xcode needed).
# Usage: apple/build.sh [--open]
set -euo pipefail
cd "${0:A:h}"

APP=build/Dynamo.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -swift-version 5 -module-name Dynamo -target "$(uname -m)-apple-macos12.0" \
  -framework AppKit -framework WebKit \
  Dynamo/*.swift -o "$APP/Contents/MacOS/Dynamo"

cp Dynamo/Info.plist "$APP/Contents/"
cp Dynamo/Dynamo.icns "$APP/Contents/Resources/"
cp -R ../web "$APP/Contents/Resources/web"

codesign --force --sign - "$APP" >/dev/null
# register .fountain association with Finder
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

echo "built $PWD/$APP"
[[ "${1:-}" == "--open" ]] && open "$APP"
exit 0
