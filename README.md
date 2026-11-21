# Amigo Secreto — Backend

API do MVP de Amigo Secreto, construída com Node.js, TypeScript, Express,
PostgreSQL e Prisma.

## Configuração

Copie `.env.example` para `.env` e informe todas as variáveis obrigatórias:

- `NODE_ENV`: `development`, `test` ou `production`.
- `PORT`: porta HTTP.
- `DATABASE_URL`: conexão PostgreSQL.
- `FRONTEND_URL`: origem exata autorizada pelo CORS e pela proteção de origem.
- `CORS_ORIGINS`: origens adicionais autorizadas, separadas por vírgula (opcional).
- `APP_URL`: URL pública usada nos links dos convites.
- `JWT_SECRET`: segredo aleatório com ao menos 32 caracteres.
- `ADMIN_USER_IDS`: IDs de contas existentes que podem consultar o painel,
  separados por vírgulas (opcional; vazio significa nenhum administrador).
- `DATA_ENCRYPTION_KEY`: chave AES-256 em Base64 para dados pessoais.
- `SORTEIO_ENCRYPTION_KEY`: chave AES-256 distinta em Base64 para resultados.
- `EMAIL_LOOKUP_SECRET`: segredo aleatório com ao menos 32 caracteres.
- `RESEND_API_KEY`: chave da API do Resend.
- `EMAIL_FROM`: remetente validado no Resend.
- `FEEDBACK_EMAIL_TO`: endereço que receberá os relatos de bugs e sugestões.
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

## Feedback

`POST /feedback` recebe relatos anônimos de bugs e sugestões e os encaminha por
e-mail. O endpoint não persiste o conteúdo nem aceita identificadores de usuário,
IDs de grupos ou tokens de participantes.

## Validação

```bash
pnpm prisma validate
pnpm prisma generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Os testes administrativos usam PGlite (PostgreSQL em memória) para validar a
cadeia de migrations, as consultas de séries diárias e o rollback de auditoria,
sem acessar `DATABASE_URL` e sem precisar de Docker.

## Administração e auditoria

O painel administrativo é somente de consulta. Para habilitá-lo, cadastre uma
conta normalmente, faça login e obtenha seu ID em `GET /auth/me`. Configure esse
ID no ambiente **do backend**, por exemplo:

```dotenv
ADMIN_USER_IDS="id-da-conta-1,id-da-conta-2"
```

Espaços são removidos e IDs duplicados são ignorados. A variável vazia ou ausente
não concede privilégios a ninguém; IDs malformados impedem o startup. A aplicação
não cria contas nem concede privilégios por e-mail. Alterações exigem reinício ou
redeploy de todas as instâncias. A conta deve continuar existindo no banco.

`GET /auth/me` acrescenta `user.isAdmin: boolean`. Login e registro mantêm seus
contratos existentes. O frontend pode usar esse campo para exibir a aba, mas a
autorização é sempre conferida pelo backend em cada requisição `/admin`.
O login usa o mesmo cookie HttpOnly `auth_token` já existente. Uma sessão inválida
ou uma conta inexistente recebe `401`; uma conta comum recebe `403`.
Todas as respostas `/admin` incluem `Cache-Control: no-store`, inclusive erros.

Antes de publicar o backend atualizado, aplique as migrations com
`pnpm db:deploy`. A nova migration cria o histórico vazio e seus índices, sem
alterar migrations anteriores nem reconstruir atividades antigas.

### Contratos HTTP

Todos os endpoints abaixo são `GET` e exigem uma conta administradora autenticada.
Filtros desconhecidos, tipos inválidos e limites excedidos retornam `400`.

| Endpoint              | Query parameters                                                   | Resposta                                                    |
| --------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `/admin/overview`     | `from`, `to`                                                       | `period`, `totals`, `activity`, `engagement`, `invitations` |
| `/admin/timeseries`   | `from`, `to`                                                       | `period`, `items: [{ date, users, groups, sorteios }]`      |
| `/admin/users`        | `q`, `page`, `pageSize`                                            | Lista paginada de contas                                    |
| `/admin/groups`       | `q`, `ownerId`, `status`, `page`, `pageSize`                       | Lista paginada de grupos                                    |
| `/admin/audit-events` | `from`, `to`, `type`, `actorUserId`, `groupId`, `page`, `pageSize` | Lista paginada de eventos e `period`                        |

`from` e `to` são datas `YYYY-MM-DD`, inclusivas, no fuso
`America/Sao_Paulo`, entre `1970-01-01` e `9999-12-30`.
O padrão é de 30 dias, terminando hoje nesse fuso.
Se apenas `to` for informado, os 30 dias terminam nessa data; se apenas `from`
for informado, o intervalo termina hoje. Aceita-se de 1 a 90 dias, incluindo
as duas datas. Internamente as consultas usam início inclusivo e o início do
dia seguinte ao fim como limite exclusivo. `period` contém `{ from, to, timeZone }`.

As listas usam `{ items, page, pageSize, total }`, com página inicial `1`,
20 itens por página por padrão, máximo de 100 e página máxima de 1.000.000.
A ordenação é por data decrescente, com ID decrescente para desempate. Página
além do último registro retorna `items: []` e preserva `total`.

- **Contas:** cada item contém `id`, `name`, `email`, `createdAt`, `groupsCount`
  e `sorteiosCount`. `q` pesquisa nome ou e-mail sem diferenciar maiúsculas.
- **Grupos:** cada item contém `id`, `name`, `status`, `createdAt`, `sorteadoAt`,
  `owner: { id, name, email }`, `participantsCount` e `revealedCount`.
  `q` pesquisa o nome do grupo sem diferenciar maiúsculas. `status` aceita
  `DRAFT`, `READY`, `SORTEADO` ou `CANCELLED`; esses valores não criam novos
  fluxos de alteração de status.
- **Eventos:** cada item contém `id`, `type`, `occurredAt`, `actorUserId`,
  `actorName`, `groupId` e `groupName`. Os dois últimos campos são nulos para
  cadastro de conta. Datas de registros são retornadas como timestamps ISO UTC.

Exemplo de `GET /admin/overview?from=2026-11-01&to=2026-11-20`:

```json
{
  "period": {
    "from": "2026-11-01",
    "to": "2026-11-20",
    "timeZone": "America/Sao_Paulo"
  },
  "totals": {
    "users": 10,
    "groups": 8,
    "sorteios": 4,
    "participations": 20,
    "groupsByStatus": { "DRAFT": 4, "READY": 0, "SORTEADO": 4, "CANCELLED": 0 }
  },
  "activity": { "newUsers": 2, "newGroups": 3, "completedSorteios": 1 },
  "engagement": { "participations": 5, "revealed": 2, "revealRate": 40 },
  "invitations": {
    "attempts": 8,
    "attemptsByStatus": { "PENDING": 0, "SENT": 6, "DELIVERED": 0, "FAILED": 2 }
  }
}
```

### Significado dos indicadores

- `totals` descreve os registros existentes em toda a plataforma, independentemente
  do período. `sorteios` conta grupos com `sorteadoAt` preenchido. Grupos excluídos
  deixam de compor as métricas atuais, inclusive séries e contagens por organizador.
- `activity` usa, respectivamente, `User.createdAt`, `Group.createdAt` e
  `Group.sorteadoAt` dentro do período. As séries usam as mesmas datas, retornam
  todos os dias e preenchem dias sem atividade com zero.
- Contas e participações são diferentes. A mesma pessoa em três grupos representa
  três participações, mesmo sem ter uma conta cadastrada.
- `engagement` considera participantes de grupos **sorteados no período** e o
  estado atual de suas revelações. Uma participação com qualquer acesso revelado
  conta uma vez, mesmo com vários tokens, revogação ou reenvio. `revealRate` é
  um percentual de 0 a 100, arredondado para duas casas; sem participantes é zero.
- `invitations` conta tentativas de convite por e-mail criadas no período,
  incluindo reenvios, agrupadas pelo status atualmente persistido. `SENT`
  significa aceito pelo provedor, não entrega na caixa de entrada. Hoje não há
  confirmação de entrega; o enum `DELIVERED` é preservado no contrato sem
  adicionar webhooks ou inferir entregas.

### Histórico e privacidade

O histórico começa com a implantação. Os tipos de evento são `USER_REGISTERED`,
`GROUP_CREATED`, `GROUP_RENAMED`, `SORTEIO_COMPLETED` e `GROUP_DELETED`.
O autor é a conta autenticada que executou a ação; no cadastro, é a conta criada.
Nome do autor e nome do grupo são snapshots do momento da ação; renomeações
posteriores e exclusões não apagam ou reescrevem os eventos anteriores.

Cada evento é persistido na mesma transação da operação de negócio. Se a gravação
da auditoria falhar, a alteração de negócio também é revertida. Ações rejeitadas
não geram eventos de sucesso. Falhas no envio dos convites após um sorteio não
desfazem o sorteio nem seu evento.

Não existem endpoints administrativos de escrita, expurgo automático ou
reconstrução histórica. Os snapshots não possuem exclusão em cascata; uma futura
funcionalidade de exclusão de contas deverá considerar sua retenção explicitamente.

As APIs administrativas não selecionam ou descriptografam resultados sorteados,
tokens, hashes de senha, dados pessoais de participantes ou conteúdo de mensagens
anônimas. Os eventos persistem somente os metadados definidos acima e não
copiam e-mails nem credenciais. Não são enviados dados de auditoria aos logs.

### Envio transacional pelo Resend

O convite existente é enviado após o sorteio: assunto e corpo incluem o nome
do organizador, e o assunto também identifica o participante. Todos os envios
(convite, redefinição de senha e feedback) possuem HTML e texto simples.
Em produção, o envio exige `EMAIL_FROM=Amigo Secreto <amigosecreto@mail.janahu.dev.br>`
e os links de acesso exigem `APP_URL=https://amigosecreto.janahu.dev.br`.
O template mantém seus estilos e os links são diretos, sem encurtadores.

Falhas transitórias de rede, HTTP 429 e 5xx têm até três tentativas, com backoff,
jitter e respeito a `Retry-After`. Esperas acima de 30 segundos encerram a
tentativa sem reenviar antecipadamente. Cada payload possui uma chave de
idempotência SHA-256 estável; o Resend a retém por 24 horas. Isso evita duplicar
o mesmo envio nos retries. Um reenvio explícito gera outro token e é um novo
envio. Não há fila persistente nem garantia de deduplicação de comandos de
reenvio distintos. O lote inicial é sequencial para reduzir rajadas.

Logs da aplicação registram somente categoria, status, número da tentativa ou
ID interno da notificação; nunca payloads, destinatários ou tokens. Use
`NODE_ENV=production` em produção: o SDK Resend também possui logs de erro
próprios fora desse ambiente. Se a aceitação pelo provedor ocorrer e a gravação
de `SENT` falhar, a notificação permanece `PENDING` para investigação, sem
classificá-la como falha de envio. Reenvios em lote ignoram `PENDING`, `SENT`
e `DELIVERED`; o reenvio individual permanece disponível ao organizador.

Click tracking e open tracking são configurações do domínio no Resend,
[não opções por mensagem](https://github.com/resend/resend-skills/blob/main/skills/resend/references/sending/overview.md).
A consulta em 20/11/2026 retornou `restricted_api_key`: a chave local permite
somente envios, portanto o estado de tracking não pôde ser confirmado.
Nenhuma configuração do domínio ou DNS foi alterada. Verifique em Resend →
Domains → mail.janahu.dev.br → Configuration. Desativar ali afeta todos os
envios do domínio e exige avaliar os demais usos; enquanto click tracking
estiver ativo, o provedor poderá reescrever os links enviados pelo backend.
