#!/bin/sh
# Runs the end-to-end test against a fresh copy of the site, in Docker (Apache + PHP 8.3, like Virtualmin).
#   sh tests/run-tests.sh
# Nothing is installed on this computer; the containers and the test database are removed afterwards.
set -e
here=$(cd "$(dirname "$0")" && pwd)
site=$(cd "$here/../public" && pwd)
net=centaur-test-$$
docker network create "$net" >/dev/null
cleanup() { docker rm -f "$net-web" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# the site is copied in, so the test database never lands next to your files
docker run -d --name "$net-web" --network "$net" php:8.3-apache sh -c '
  a2enmod -q rewrite headers >/dev/null
  sed -i "s/AllowOverride None/AllowOverride All/" /etc/apache2/apache2.conf
  until [ -f /var/www/html/api.php ]; do sleep 0.2; done
  chown www-data /var/www
  exec apache2-foreground' >/dev/null
docker cp "$site/." "$net-web:/var/www/html/"

docker run --rm --network "$net" -e BASE="http://$net-web/" -v "$here:/tests:ro" \
  mcr.microsoft.com/playwright/python:v1.48.0-jammy \
  sh -c 'pip install -q playwright==1.48.0 2>/dev/null && python3 /tests/test_app.py'
