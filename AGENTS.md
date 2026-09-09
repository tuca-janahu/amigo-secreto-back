# AGENTS.md

## Stack

- Use `pnpm` como único package manager.
- Use Node.js, TypeScript em modo strict, Express, PostgreSQL, Prisma, Zod e Vitest.

## Arquitetura

- Mantenha arquitetura modular em `src/modules`.
- Fluxo padrão: `route → controller → service → Prisma` quando houver acesso a dados.
- Routes definem endpoints e middlewares.
- Controllers tratam apenas preocupações HTTP e nunca acessam Prisma diretamente.
- Regras de negócio ficam em services.
- Não crie repositories sem justificativa real.
- Evite abstrações prematuras, classes sem necessidade e frameworks de injeção de dependência.

## Segurança

- Futuramente, senhas devem ser armazenadas somente por hash seguro.
- Use bcrypt para senhas; nunca para criptografia reversível.
- Não registre dados pessoais sensíveis em logs.
- Tokens, secrets, chaves criptográficas e resultados de sorteios nunca podem aparecer em logs.
- Nenhum endpoint administrativo deve expor o mapeamento completo do sorteio.
- Secrets devem vir de variáveis de ambiente; nunca os coloque no código-fonte.

## Banco de dados

- Mudanças de schema passam pelo Prisma.
- Nunca modifique uma migration antiga que já foi aplicada.
- Gere uma nova migration para cada alteração aplicável.
- Evite SQL raw sem necessidade e justificativa explícita.

## Qualidade

Antes de concluir uma tarefa, execute:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`

## Escopo

- Não implemente funcionalidades não solicitadas nem antecipe SPECs futuras.
- Prefira a solução mais simples que satisfaça os requisitos.
- Preserve a compatibilidade com o restante da arquitetura.
