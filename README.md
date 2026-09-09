# Amigo Secreto — Backend

Backend da aplicação de Amigo Secreto. Este repositório contém somente a API; o frontend é mantido separadamente.

## Stack

- Node.js 22 LTS
- TypeScript (strict)
- Express
- PostgreSQL e Prisma
- Zod
- Vitest e Supertest

## Pré-requisitos

- Node.js 22 (veja `.nvmrc`)
- pnpm 10+
- PostgreSQL disponível

## Instalação

```bash
pnpm install
cp .env.example .env
```

No Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

Atualize `DATABASE_URL` e `FRONTEND_URL` no arquivo `.env` para o seu ambiente.

## Comandos principais

```bash
pnpm dev          # inicia em desenvolvimento
pnpm test         # executa os testes
pnpm typecheck    # verifica os tipos
pnpm lint         # verifica o código
pnpm build        # gera dist/
pnpm start        # executa o build de produção
```

## Banco de dados

O banco de dados é PostgreSQL, acessado pelo Prisma. Em desenvolvimento, aplique
as migrations com `pnpm prisma migrate dev` e gere o Prisma Client com
`pnpm prisma generate`.

Os dados pessoais de `Participant` serão armazenados de forma criptografada em
uma etapa futura; esta versão apenas prepara os campos de persistência.

## Organização

```text
src/
  config/       validação e acesso centralizado à configuração
  lib/          integrações compartilhadas, como Prisma
  middlewares/  tratamento global de erros
  modules/      módulos da API (route → controller → service)
  app.ts        configuração do Express, sem iniciar a porta
  server.ts     inicialização do processo HTTP
prisma/         schema do Prisma
tests/          testes automatizados
```
