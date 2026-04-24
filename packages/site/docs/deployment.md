# _Deployment_

Documenta como os artefatos de dados e a _build_ do site chegam em
produção.

## Infraestrutura

| Recurso                 | Identificador                          |
| ----------------------- | -------------------------------------- |
| Bucket S3               | `precisa-saude-datasus-brasil`         |
| Região                  | `sa-east-1`                            |
| Distribuição CloudFront | `dfdu08vi8wsus.cloudfront.net`         |
| Acesso                  | OAC (Origin Access Control)            |
| CORS                    | Permissivo (GET, HEAD, Range, OPTIONS) |

O bucket hospeda **apenas dados** (Parquet, PMTiles, manifesto). A
_build_ do site (HTML, JS, CSS) é servida por outro canal — tipicamente
o pipeline de _deploy_ do site principal da Precisa Saúde ou um host
estático (Netlify, Vercel, Cloudflare Pages).

## Artefatos de dados

### Layout

```
s3://precisa-saude-datasus-brasil/
├── geo/
│   └── brasil.pmtiles
├── parquet-opt/
│   ├── uf-totals.parquet
│   ├── uf=AC/part.parquet
│   ├── uf=AL/part.parquet
│   └── ... (27 UFs)
└── manifest/
    └── index.json
```

### Publicação

```bash
pnpm -F @datasus-viz/site upload:aws
```

Pré-requisitos:

- AWS CLI configurado (`aws configure` ou `AWS_PROFILE`).
- Credenciais com `s3:PutObject` no bucket em `sa-east-1`.

O _script_ usa `aws s3 cp` e `aws s3 sync --delete`; remove do bucket
os arquivos que sumiram localmente.

### _Cache policy_

| Caminho               | `Cache-Control`                       | Motivo                                        |
| --------------------- | ------------------------------------- | --------------------------------------------- |
| `geo/*.pmtiles`       | `public, max-age=31536000, immutable` | Geometria muda muito raramente                |
| `parquet-opt/**`      | `public, max-age=31536000, immutable` | Reemitidos só quando há novos microdados      |
| `manifest/index.json` | `public, max-age=3600`                | Janela curta para propagar novas competências |

`Content-Type`:

- `.pmtiles` → `application/vnd.pmtiles`
- `.json` → `application/json`
- `.parquet` → _default_ (octet-stream serve; alguns clientes se
  beneficiam de `application/vnd.apache.parquet`, mas DuckDB WASM lê
  pelo conteúdo, não pelo _header_).

### Invalidação do CloudFront

`upload-aws.sh` **não invalida**. Como PMTiles e Parquet têm TTL de 1
ano e sobrescrita acontece em cima do mesmo _key_, os _edges_ podem
servir a versão antiga até expirar.

Estratégias:

1. **Tolerar _staleness_ de 1 hora** — o `manifest/index.json` expira
   em 1 h, e o site condiciona busca de dados à lista de competências
   do manifesto. Se a nova competência ainda não aparece, o usuário vê
   o _dataset_ antigo, mas consistente.
2. **Invalidação pontual** após publicar microdados novos:
   ```bash
   aws cloudfront create-invalidation \
     --distribution-id <DIST_ID> \
     --paths '/parquet-opt/*' '/manifest/index.json'
   ```
3. **_Hash_ no nome** — alternativa de longo prazo (ex.: `uf-totals-<sha>.parquet`,
   com o manifesto apontando para o _hash_ corrente). Não implementado.

## _Build_ do site

```bash
pnpm -F @datasus-viz/site build
```

Gera `packages/site/dist/` (estático). Vite aplica _chunking_ manual
separando `vendor-mapbox` e `vendor-react` em _bundles_ próprios para
_cache hit_ em _deploys_ subsequentes.

### Variáveis de ambiente na _build_

| Variável             | Obrigatória | Finalidade                                       |
| -------------------- | ----------- | ------------------------------------------------ |
| `VITE_MAPBOX_TOKEN`  | Recomendada | _Token_ Mapbox; sem ela o mapa cai em modo texto |
| `VITE_DATA_BASE_URL` | Não         | Sobrescreve o _base URL_ do CloudFront (dev/QA)  |

Em CI, injetar via _secret_ do _provider_. Nunca _commitar_ em `.env`.

### Alvos de _deploy_ suportados

O _output_ é estático e pode ser servido por:

- Netlify / Vercel / Cloudflare Pages (_detect_ automático).
- S3 + CloudFront (outro bucket, separado do de dados).
- Qualquer CDN estático.

## CORS

O bucket precisa permitir _Range Requests_ cross-origin do domínio
que servir o site. Configuração atual:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

Restringir `AllowedOrigins` ao domínio de produção do site é uma
melhoria de _hardening_ viável — o _dataset_ é público, mas CORS
restrito evita que terceiros rodem DuckDB WASM contra o bucket a
partir de _origins_ arbitrárias.

## Ver também

- [`data-pipeline.md`](./data-pipeline.md) — como gerar os artefatos
  antes de publicar.
- [`architecture.md`](./architecture.md) — por que servir Parquet +
  PMTiles estático (em vez de _backend_ dedicado).
