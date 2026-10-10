#!/bin/zsh
# Build Dynamo.app with the Command Line Tools only (no Xcode needed).
# Usage: apple/build.sh [--open]
set -euo pipefail
cd "${0:A:h}"

APP=build/Dynamo.app
rm -rf "$APP" build/Dynamo.zip
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -module-name Dynamo -target "$arch-apple-macos12.0" \
    -framework AppKit -framework WebKit \
    Dynamo/*.swift -o "build/Dynamo-$arch"
done
# universal binary so the .app runs on Apple Silicon and Intel Macs
lipo -create build/Dynamo-arm64 build/Dynamo-x86_64 -output "$APP/Contents/MacOS/Dynamo"
rm build/Dynamo-arm64 build/Dynamo-x86_64

cp Dynamo/Info.plist "$APP/Contents/"
cp Dynamo/Dynamo.icns "$APP/Contents/Resources/"
cp -R ../web "$APP/Contents/Resources/web"

codesign --force --sign - "$APP" >/dev/null
# register .fountain association with Finder
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
# portable copy for other Macs (ditto keeps the signature intact)
ditto -c -k --keepParent "$APP" build/Dynamo.zip

echo "built $PWD/$APP"
echo "zip   $PWD/build/Dynamo.zip"
[[ "${1:-}" == "--open" ]] && open "$APP"
exit 0
