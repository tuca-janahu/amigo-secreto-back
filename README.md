# Amigo Secreto — Backend

API do MVP de Amigo Secreto, construída com Node.js, TypeScript, Express,
PostgreSQL e Prisma.

## Configuração

Copie `.env.example` para `.env` e informe todas as variáveis obrigatórias:

- `NODE_ENV`: `development`, `test` ou `production`.
- `PORT`: porta HTTP.
- `DATABASE_URL`: conexão PostgreSQL.
- `FRONTEND_URL`: origem exata autorizada pelo CORS e pela proteção de origem.
- `APP_URL`: URL pública usada nos links dos convites.
- `JWT_SECRET`: segredo aleatório com ao menos 32 caracteres.
- `DATA_ENCRYPTION_KEY`: chave AES-256 em Base64 para dados pessoais.
- `SORTEIO_ENCRYPTION_KEY`: chave AES-256 distinta em Base64 para resultados.
- `EMAIL_LOOKUP_SECRET`: segredo aleatório com ao menos 32 caracteres.
- `RESEND_API_KEY`: chave da API do Resend.
- `EMAIL_FROM`: remetente validado no Resend.
- `TRUST_PROXY_HOPS`: quantidade de proxies confiáveis até a API. O padrão é `1`
  em produção (Coolify) e `0` nos demais ambientes.

Gere cada chave AES-256 com `openssl rand -base64 32`. Não reutilize chaves entre
finalidades nem versione o arquivo `.env`.

## Desenvolvimento

```bash
pnpm install
pnpm prisma generate
pnpm prisma migrate dev
pnpm dev
```

## Produção

O reverse proxy deve ser o único ponto público de entrada da API. O valor padrão
`TRUST_PROXY_HOPS=1` confia somente no salto direto do Coolify para obter o IP do
cliente; ajuste-o se a topologia ganhar outro proxy. Os rate limits usam memória
local e deverão adotar um store compartilhado caso a aplicação passe a ter várias
instâncias.

```bash
pnpm install --frozen-lockfile
pnpm prisma generate
pnpm prisma migrate deploy
pnpm build
pnpm start
```

O script `pnpm db:deploy` é um atalho para `prisma migrate deploy`. A aplicação
não executa migrations automaticamente no startup.

## Health check

`GET /health` é público e retorna somente:

```json
{ "status": "ok" }
```

## Validação

```bash
pnpm prisma validate
pnpm prisma generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
