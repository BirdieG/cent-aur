#!/bin/sh
# Tests the desktop app (desktop/) against a fresh Cent-aur server, in Docker.
#   sh tests/run-desktop-tests.sh
# The app's own server is the same code as in Cent-aur.exe, built for Linux (it has no window
# there); the browser plays the window. Everything runs in throw-away containers.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
net=centaur-desk-$$
docker network create "$net" >/dev/null
cleanup() { rm -f "$root/desktop/dist/cent-aur-test"; docker rm -f "$net-web" "$net-desk" >/dev/null 2>&1 || true; docker volume rm "$net-data" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# the Cent-aur server (as in run-tests.sh)
docker run -d --name "$net-web" --network "$net" php:8.3-apache sh -c '
  a2enmod -q rewrite headers >/dev/null
  sed -i "s/AllowOverride None/AllowOverride All/" /etc/apache2/apache2.conf
  until [ -f /var/www/html/api.php ]; do sleep 0.2; done
  chown www-data /var/www
  exec apache2-foreground' >/dev/null
docker cp "$root/public/." "$net-web:/var/www/html/"

# the desktop app, with the page copied in as build.sh does
rm -rf "$root/desktop/web" && mkdir -p "$root/desktop/web"
for f in index.html app.js manifest.webmanifest app-icons; do cp -R "$root/public/$f" "$root/desktop/web/"; done
docker volume create centaur-go-cache >/dev/null
docker run --rm -v "$root:/src" -v centaur-go-cache:/go -w /src/desktop -e OWNER="$(id -u):$(id -g)" golang:1.26 sh -c "
  CGO_ENABLED=0 go build -ldflags '-X main.defaultServer=http://$net-web' -o dist/cent-aur-test . && chown -R \$OWNER dist web"
docker run -d --name "$net-desk" --network "$net" -v "$root/desktop/dist:/app:ro" -v "$net-data:/data" \
  -e CENTAUR_DIR=/data -e CENTAUR_PORT=47800 golang:1.26 /app/cent-aur-test >/dev/null

# each start prints a new address (a new launch key): wait for one that was not used yet
used=""
phase() {
  for i in $(seq 1 100); do url=$(docker logs "$net-desk" 2>/dev/null | grep '^http://' | tail -1); [ -n "$url" ] && [ "$url" != "$used" ] && break; sleep 0.2; done
  used=$url
  echo "--- $1"
  docker run --rm --network "container:$net-desk" -e DESK_URL="$url" -e SERVER="http://$net-web" \
    -v "$here:/tests:ro" -v centaur-pip-cache:/root/.cache/pip mcr.microsoft.com/playwright/python:v1.48.0-jammy \
    sh -c "pip install -q playwright==1.48.0 2>/dev/null && python3 /tests/test_desktop.py $1"
}
restart() { docker restart -t 1 "$net-desk" >/dev/null; }

phase first
restart
phase second
echo "--- on the server and on the PC after signing in"
docker exec "$net-web" php -r '$p=new PDO("sqlite:/var/www/cent-aur-data/cent-aur.db"); $d=$p->query("select data from docs")->fetchColumn(); echo (strpos($d,"Online rent")!==false && strpos($d,"Offline coffee")===false ? "ok    " : "FAIL  "), "the server holds the signed-in data, not the offline data\n";'
docker exec "$net-desk" sh -c 'grep -q "\"mode\": \"online\"" /data/moved/settings.json && grep -q "\"cookie\"" /data/moved/settings.json' \
  && echo "ok    the app remembers the sign-in (in the chosen data folder)" || echo "FAIL  the app remembers the sign-in (in the chosen data folder)"
docker exec "$net-desk" sh -c '[ "$(cat /data/location.txt)" = /data/moved ] && [ ! -e /data/cent-aur.db ] && [ -e /data/moved/cent-aur.db ]' \
  && echo "ok    the data was moved, not copied; the standard folder names where it went" || echo "FAIL  the data was moved, not copied; the standard folder names where it went"
restart
phase third
docker exec "$net-desk" sh -c '[ ! -e /data/location.txt ] && [ -e /data/cent-aur.db ] && [ ! -e /data/moved/cent-aur.db ]' \
  && echo "ok    back in the standard folder: the data is there again and nothing is left behind" || echo "FAIL  back in the standard folder: the data is there again and nothing is left behind"
