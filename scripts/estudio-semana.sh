#!/usr/bin/env bash
# Partida de estudio de la fase 3: 7 días de juego con dos semillas (7 y 13) EN PARALELO, cada
# una con su servidor «todo en uno» (sin la web), su base de datos, su puerto y su grabación.
#
#   scripts/estudio-semana.sh prepare        # bases nuevas y migradas + usuario director
#   scripts/estudio-semana.sh start [s7|s13] # arranca el servidor (o los dos)
#   scripts/estudio-semana.sh record [s7|s13]# graba 168 h de juego
#   scripts/estudio-semana.sh status         # salud, hora de juego, memoria, coste
#   scripts/estudio-semana.sh stop [s7|s13]  # para (guarda la instantánea al cerrar)
#   scripts/estudio-semana.sh export [s7|s13]# world:export a <carpeta>/bd
#
# Si un servidor se cae, `start` lo reanuda desde su última instantánea (y la grabación
# reconecta sola). Entorno: .env (secretos) + .env.study.<semilla> (sin secretos; su
# DATABASE_URL usa ${POSTGRES_PASSWORD} de .env, por eso se carga después).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/estudio/semana-fase3"
HOURS="${HOURS:-168}"
# Minuto de juego en que acaba la grabación: el inicio (día 0, 06:50) más HOURS. Así, si hay que
# relanzar `record`, termina donde debía.
UNTIL="${UNTIL:-$((410 + HOURS * 60))}"
SEEDS=(s7 s13)
cd "$ROOT"

seeds_of() { if [[ -n "${1:-}" ]]; then echo "$1"; else echo "${SEEDS[@]}"; fi; }

# Carga .env y encima el de la semilla, en una subshell (no ensucia la shell que llama).
with_env() {
  local seed="$1"
  shift
  (
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/.env"
    # shellcheck disable=SC1090
    . "$ROOT/.env.study.$seed"
    set +a
    export NODE_OPTIONS="--max-old-space-size=4096"
    "$@"
  )
}

db_name() { grep -E '^DATABASE_URL=' "$ROOT/.env.study.$1" | sed -E 's#.*/([^/?]+).*#\1#'; }
port_of() { grep -E '^PORT=' "$ROOT/.env.study.$1" | cut -d= -f2; }
origin_of() { grep -E '^ALLOWED_ORIGINS=' "$ROOT/.env.study.$1" | cut -d= -f2 | cut -d, -f1; }
pid_alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

prepare() {
  pnpm db:up >/dev/null
  until docker exec lethetown-db pg_isready -U lethetown >/dev/null 2>&1; do sleep 1; done
  for seed in $(seeds_of "${1:-}"); do
    local db dir
    db="$(db_name "$seed")"
    dir="$OUT/$seed"
    mkdir -p "$dir"
    if docker exec lethetown-db psql -U lethetown -tAc "select 1 from pg_database where datname='$db'" | grep -q 1; then
      echo "La base $db ya existe: no la toco (bórrala a mano si quieres empezar de cero)." >&2
      exit 1
    fi
    docker exec lethetown-db createdb -U lethetown "$db"
    with_env "$seed" pnpm -s db:migrate
    # Contraseña del director, solo en local (estudio/ está fuera de git).
    if [[ ! -f "$dir/.record-pass" ]]; then
      (umask 077 && openssl rand -hex 16 >"$dir/.record-pass")
    fi
    with_env "$seed" pnpm -s user:create grabador director <"$dir/.record-pass"
    echo "✔ $seed: base $db nueva y migrada, usuario grabador (director)."
  done
}

start() {
  for seed in $(seeds_of "${1:-}"); do
    local dir="$OUT/$seed"
    mkdir -p "$dir"
    if pid_alive "$dir/server.pid"; then
      echo "$seed: el servidor ya está en marcha (pid $(cat "$dir/server.pid"))."
      continue
    fi
    # Todo en uno sin watch (la API y la simulación en un proceso), como líder de su grupo:
    # el pid es el de node y `stop` le manda SIGTERM (guarda la instantánea al cerrar).
    setsid bash -c "set -a; . '$ROOT/.env'; . '$ROOT/.env.study.$seed'; set +a
      export NODE_OPTIONS=--max-old-space-size=4096
      cd '$ROOT/apps/server' && exec node --import tsx src/index.ts" \
      >>"$dir/server.log" 2>&1 </dev/null &
    echo $! >"$dir/server.pid"
    echo "$seed: servidor arrancado (pid $!), log en $dir/server.log, puerto $(port_of "$seed")."
  done
}

record() {
  for seed in $(seeds_of "${1:-}"); do
    local dir="$OUT/$seed"
    if pid_alive "$dir/record.pid"; then
      echo "$seed: ya se está grabando (pid $(cat "$dir/record.pid"))."
      continue
    fi
    RECORD_USER=grabador RECORD_PASSWORD="$(cat "$dir/.record-pass")" \
      setsid pnpm -s --filter @lethetown/server record "$dir" --hours "$HOURS" --until "$UNTIL" \
      --api "http://localhost:$(port_of "$seed")" --origin "$(origin_of "$seed")" \
      >>"$dir/record.log" 2>&1 </dev/null &
    echo $! >"$dir/record.pid"
    echo "$seed: grabando hasta el minuto de juego $UNTIL ($HOURS h desde el día 0; pid $!), log en $dir/record.log."
  done
}

status() {
  for seed in "${SEEDS[@]}"; do
    local dir="$OUT/$seed" port
    port="$(port_of "$seed")"
    local srv="caído" rec="parado" rss="-"
    if pid_alive "$dir/server.pid"; then
      srv="pid $(cat "$dir/server.pid")"
      rss="$(ps -o rss= -p "$(cat "$dir/server.pid")" | awk '{printf "%.0f MB", $1/1024}')"
    fi
    pid_alive "$dir/record.pid" && rec="pid $(cat "$dir/record.pid")"
    local health
    health="$(curl -s -m 5 "http://localhost:$port/api/health" || echo 'sin respuesta')"
    echo "$seed · servidor: $srv ($rss) · grabación: $rec · health: $health"
  done
}

stop() {
  for seed in $(seeds_of "${1:-}"); do
    local dir="$OUT/$seed"
    for what in record server; do
      if pid_alive "$dir/$what.pid"; then
        # Al grupo entero (setsid): node guarda la instantánea al recibir SIGTERM.
        kill -TERM -- "-$(cat "$dir/$what.pid")" 2>/dev/null || kill -TERM "$(cat "$dir/$what.pid")"
        echo "$seed: $what parado."
      fi
    done
  done
}

export_bd() {
  for seed in $(seeds_of "${1:-}"); do
    with_env "$seed" pnpm -s --filter @lethetown/server world:export "$OUT/$seed/bd" --world default
  done
}

cmd="${1:-}"
shift || true
case "$cmd" in
  prepare) prepare "$@" ;;
  start) start "$@" ;;
  record) record "$@" ;;
  status) status ;;
  stop) stop "$@" ;;
  export) export_bd "$@" ;;
  *)
    sed -n '2,13p' "$0"
    exit 1
    ;;
esac
