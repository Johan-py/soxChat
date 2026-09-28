# SoxChat

Plataforma de chat cifrado extremo a extremo (E2EE) y temporal, con envío de archivos.

## Características

- **Cifrado E2EE:** AES-256-GCM con claves derivadas por HKDF
- **Temporal:** Salas con TTL configurable, destrucción automática al expirar
- **Archivos:** Transferencia cifrada por chunks de 64 KB
- **Sin registro:** Solo nick temporal, sin cuentas
- **Sin persistencia:** El servidor solo retransmite en memoria
- **Seguridad:** CSP estricta, HSTS, rate limiting, validación estricta

## Arquitectura

```
┌─────────────┐         TLS (Caddy)         ┌──────────────────────┐
│  Navegador  │ ◄──────────────────────────► │  Fastify + ws        │
│  (Vite TS)  │   WS /ws/room/:id           │                      │
└─────────────┘                              │  ┌────────────────┐  │
                                             │  │ RoomManager    │  │
                                             │  │ (solo memoria) │  │
                                             │  └────────────────┘  │
                                             │  ┌────────────────┐  │
                                             │  │ FileStore      │  │
                                             │  │ (tmp en disco) │  │
                                             │  └────────────────┘  │
                                             └──────────────────────┘
```

## Despliegue Rápido (Docker)

```bash
# Clonar el repositorio
git clone <repo-url>
cd soxChat

# Levantar todos los servicios
docker-compose up --build

# Abrir en el navegador
open http://localhost
```

## Desarrollo Local

### Servidor

```bash
cd server
npm install
npm run dev
```

### Cliente

```bash
cd client
npm install
npm run dev
```

## Tests

```bash
# Tests del servidor
cd server
npm test

# Tests del cliente
cd client
npm test
```

## Configuración

Todas las variables de entorno tienen valores por defecto:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | 3000 | Puerto del servidor |
| `ROOM_TTL_MS` | 3600000 | TTL de sala en ms (1 hora) |
| `MAX_ROOMS` | 1000 | Máximo de salas activas |
| `MAX_PARTICIPANTS_PER_ROOM` | 20 | Máximo de participantes por sala |
| `MAX_MESSAGE_BYTES` | 4096 | Tamaño máximo de mensaje |
| `MAX_FILE_BYTES` | 10485760 | Tamaño máximo de archivo (10 MB) |
| `CHUNK_SIZE` | 65536 | Tamaño de chunk (64 KB) |
| `RATE_LIMIT_ROOM_CREATE_MAX` | 10 | Creaciones de sala por IP por minuto |
| `RATE_LIMIT_WS_CONNECT_MAX` | 30 | Conexiones WS por IP por minuto |

## Protocolo WebSocket

### Cliente → Servidor

| Evento | Payload |
|--------|---------|
| `join` | `{ nick: string }` |
| `msg` | `{ iv: b64, ct: b64, ts: number }` |
| `file:offer` | `{ fileId, nameEnc, mimeEnc, size, chunkCount, iv }` |
| `file:chunk` | `{ fileId, index, iv, data }` |
| `leave` | `{}` |

### Servidor → Cliente

| Evento | Payload |
|--------|---------|
| `joined` | `{ userId, participants: Array<{ id, nick }> }` |
| `peer:joined` | `{ userId, nick }` |
| `peer:left` | `{ userId }` |
| `msg` | `{ from, iv, ct, ts }` |
| `file:offer` | `{ from, fileId, nameEnc, mimeEnc, size, chunkCount, iv }` |
| `file:chunk` | `{ from, fileId, index, iv, data }` |
| `file:done` | `{ from, fileId }` |
| `error` | `{ code: string }` |
| `room:destroyed` | `{}` |

## Seguridad

Ver [THREATMODEL.md](docs/THREATMODEL.md) para el modelo de amenazas completo y [CRYPTO.md](docs/CRYPTO.md) para la arquitectura criptográfica.

### Cabeceras de Seguridad

- `Content-Security-Policy`: sin scripts inline, sin recursos externos
- `Strict-Transport-Security`: 1 año, includeSubDomains, preload
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- `Permissions-Policy`: restringe cámara, micrófono, geolocalización

## Estructura del Proyecto

```
/
├── server/           # Fastify + ws (TypeScript)
│   ├── src/
│   │   ├── index.ts      # Entry point
│   │   ├── config.ts     # Configuración
│   │   ├── room.ts       # RoomManager
│   │   ├── fileStore.ts  # Almacenamiento temporal
│   │   ├── ratelimit.ts  # Rate limiting
│   │   └── security.ts   # Cabeceras de seguridad
│   └── tests/
├── client/           # Vite + TypeScript vanilla
│   ├── src/
│   │   ├── main.ts       # Lógica del cliente
│   │   ├── crypto.ts     # Cifrado de mensajes
│   │   └── fileCrypto.ts # Cifrado de archivos
│   └── tests/
├── docs/             # Documentación
│   ├── THREATMODEL.md
│   ├── CRYPTO.md
│   └── README.md
├── tests/            # Tests e2e
├── docker-compose.yml
└── Caddyfile
```

## Licencia

Proyecto académico — Ciberseguridad
