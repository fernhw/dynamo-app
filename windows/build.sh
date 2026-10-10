#!/bin/zsh
# Build portable Dynamo.exe (Windows x64) — works from macOS/Linux with the .NET SDK.
# Output: windows/build/Dynamo-windows.zip  (Dynamo.exe + optional .fountain association scripts)
set -euo pipefail
cd "${0:A:h}"

OUT=build/Dynamo-windows
rm -rf build
dotnet publish Dynamo.csproj -c Release -o "$OUT" --nologo -v quiet
cp dist/*.cmd Dynamo.ico "$OUT/"
# Windows .cmd files want CRLF
for f in "$OUT"/*.cmd; do perl -pi -e 's/\r?\n/\r\n/' "$f"; done
(cd build && zip -qr Dynamo-windows.zip Dynamo-windows)

ls -lh "$OUT"
echo "zip   $PWD/build/Dynamo-windows.zip"
