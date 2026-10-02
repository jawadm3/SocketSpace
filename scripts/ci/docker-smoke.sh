#!/usr/bin/env bash
# Builds both Docker images and checks that each container starts, answers, refuses what it
# should, runs as an unprivileged user and shuts down cleanly (DEV-03, REL-01).
#
# Runs in CI with a PostgreSQL service on localhost:5432 whose database is already migrated.
# Every secret here is generated on the spot for this throwaway run.
set -euo pipefail

DB_URL="${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"
secret() { openssl rand -hex 24; }

wait_for() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  echo "timed out waiting for $url" >&2
  return 1
}

echo "::group::Build images"
docker build -f apps/realtime/Dockerfile -t socketspace-realtime:ci .
docker build -f apps/web/Dockerfile -t socketspace-web:ci .
echo "::endgroup::"

for image in socketspace-realtime:ci socketspace-web:ci; do
  user="$(docker image inspect "$image" --format '{{.Config.User}}')"
  echo "$image runs as: $user"
  test "$user" = "node"
done

echo "::group::Realtime container"
docker run -d --name rt --network host \
  -e PORT=4000 -e HOST=127.0.0.1 \
  -e DATABASE_URL="$DB_URL" \
  -e WEB_ORIGINS=http://localhost:3000 \
  -e AUTH_JWKS_URL=http://localhost:3000/api/auth/jwks \
  -e AUTH_ISSUER=http://localhost:3000 \
  -e INTERNAL_EVENTS_SECRET="$(secret)" \
  -e METRICS_TOKEN="$(secret)" \
  socketspace-realtime:ci
wait_for http://127.0.0.1:4000/healthz
curl -fsS http://127.0.0.1:4000/healthz
# A Socket.IO handshake without an allowed Origin is refused.
code="$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:4000/socket.io/?EIO=4&transport=polling')"
echo "handshake without origin: $code"; test "$code" = "403"
code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: http://localhost:3000' 'http://127.0.0.1:4000/socket.io/?EIO=4&transport=polling')"
echo "handshake from the web origin: $code"; test "$code" = "200"
# Metrics need the token.
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/metrics)"
echo "metrics without token: $code"; test "$code" = "401"
echo "::endgroup::"

echo "::group::Web container"
docker run -d --name web --network host \
  -e PORT=3000 -e HOSTNAME=127.0.0.1 \
  -e DATABASE_URL="$DB_URL" \
  -e BETTER_AUTH_SECRET="$(secret)" \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  -e REALTIME_PUBLIC_URL=http://127.0.0.1:4000 \
  -e INTERNAL_EVENTS_SECRET="$(secret)" \
  -e EMAIL_DRIVER=memory \
  socketspace-web:ci
wait_for http://127.0.0.1:3000/sign-in
headers="$(curl -fsS -D - -o /dev/null http://127.0.0.1:3000/sign-in)"
echo "$headers" | grep -i "^content-security-policy: .*nonce-"
echo "$headers" | grep -i "^x-frame-options: DENY"
curl -fsS http://127.0.0.1:3000/api/auth/jwks | grep -q '"keys"'
echo "::endgroup::"

echo "::group::Realtime readiness with the web app's keys"
wait_for http://127.0.0.1:4000/readyz
curl -fsS http://127.0.0.1:4000/readyz
echo "::endgroup::"

echo "::group::Graceful shutdown (SIGTERM)"
docker stop --time 15 rt
exit_code="$(docker inspect rt --format '{{.State.ExitCode}}')"
docker logs rt 2>&1 | tail -5
echo "realtime exit code: $exit_code"; test "$exit_code" = "0"
docker logs rt 2>&1 | grep -q '"shutdown complete"'
docker stop --time 15 web
echo "::endgroup::"

echo "Docker smoke test passed."
