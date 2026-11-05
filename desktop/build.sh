#!/bin/sh
# Builds Cent-aur.exe for 64-bit Windows, using Docker (nothing is installed on this computer).
#
#   sh desktop/build.sh      ->  desktop/dist/Cent-aur.exe
#
# The sign-in form offers https://cent-aur.com/; people can change it there. To build for another
# server, give its address: sh desktop/build.sh https://cent-aur.example.com
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
server=${1:-https://cent-aur.com/}
version=2.0.4

# The program serves the page from inside itself: copy it from public/ (api.php stays out).
rm -rf "$here/web"
mkdir -p "$here/web"
for f in index.html boot.js app.js manifest.webmanifest app-icons; do cp -R "$root/public/$f" "$here/web/"; done

docker volume create centaur-go-cache >/dev/null
docker run --rm -v "$root:/src" -v centaur-go-cache:/go -w /src/desktop \
  -e SERVER="$server" -e VERSION="$version" -e OWNER="$(id -u):$(id -g)" golang:1.26 sh -c '
  set -e
  go mod tidy
  # icon, version details and Windows settings (sharp on high-DPI screens) that go inside the .exe
  go run github.com/tc-hib/go-winres@v0.3.3 simply --arch amd64 --out rsrc --manifest gui \
    --icon ../public/app-icons/icon-512.png --product-name Cent-aur --file-description Cent-aur \
    --original-filename Cent-aur.exe --product-version "$VERSION" --file-version "$VERSION"
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -buildvcs=false \
    -ldflags "-H windowsgui -s -w -X main.defaultServer=$SERVER -X main.version=$VERSION" -o dist/Cent-aur.exe .
  chown -R "$OWNER" dist web go.mod go.sum rsrc_windows_amd64.syso'
ls -l "$here/dist/Cent-aur.exe"
