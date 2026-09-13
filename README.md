# CodePro Host Site V1

Site Node.js integrado às APIs do HaxBot V9/V14, com login Discord OAuth2, área pública de preços, painel de clientes e administração.

## O que já tem

- Login/"verificação" pela conta Discord usando OAuth2.
- Cliente vê apenas os painéis HaxBall vinculados ao Discord ID dele.
- Área pública de preços e produtos.
- Nenhuma categoria ou produto pré-salvo.
- Admin cria categorias, produtos e preços pelo próprio site.
- Admin cadastra painéis HaxBall (URL + CONTROL_API_KEY).
- Admin vincula um ou vários painéis a cada Discord ID.
- Admins extras pelo painel e donos fixos pelo `.env`.
- Configurações visuais/textuais do site.
- Histórico administrativo.
- Painel HaxBall web com: status, jogadores, nome da sala, restart da host, senhas, senha ativa, !adm, Discord, boas-vindas, replay mínimo, chat geral/SPEC, anúncios, cargos/tags/fontes, ADM por CONN, jogadores conhecidos, bans, mapas .hbs, uniformes, webhooks por ID de canal, ranking e lista de replays.
- API Key da sala nunca é enviada ao navegador.
- Developer/Programador continua bloqueado para clientes porque a API HaxBall já protege essa senha/cargo.

## 1. Instalação

```bash
npm install
```

Copie `.env.example` para `.env` e configure.

```bash
npm start
```

## 2. Discord Developer Portal

Use a aplicação CodePro Host e, em **OAuth2**, adicione a Redirect URI:

```text
https://SEU-DOMINIO.com/auth/discord/callback
```

No `.env`:

```env
DISCORD_CLIENT_ID=1414012731341672458
DISCORD_CLIENT_SECRET=SEU_CLIENT_SECRET
DISCORD_REDIRECT_URI=https://SEU-DOMINIO.com/auth/discord/callback
ADMIN_DISCORD_IDS=SEU_DISCORD_ID
```

**Nunca publique `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `SESSION_SECRET` ou CONTROL_API_KEY.**

## 3. Painéis HaxBall

A sala precisa estar usando a API da versão atual do HaxBot:

```env
CONTROL_API_HOST=0.0.0.0
CONTROL_API_PORT=PORTA_DA_HOST
CONTROL_API_KEY=CHAVE_PRIVADA
```

No admin do site, cadastre:

- Nome da sala
- URL: `http://bot-1.pixelhubhost.com:25833` (exemplo)
- CONTROL_API_KEY

Depois vá em **Clientes** e vincule o Discord ID do comprador ao painel.

## 4. Compartilhar as salas com o bot Discord

Se o site e o CodePro Discord estiverem **na mesma máquina/container**, aponte:

```env
CODEPRO_SHARED_DATA_DIR=/home/container/data
```

O site passa a usar o mesmo `hax_panel_rooms.json` do `/salacliente` do bot Discord. Assim, uma sala cadastrada no Discord também aparece na administração do site.

Se estiverem em hosts diferentes, deixe vazio e cadastre as salas pelo Admin do site. A API HaxBall continua funcionando normalmente pela URL pública.

## 5. Webhooks por ID de canal

Para a tela Webhooks criar webhooks a partir do ID do canal, configure:

```env
DISCORD_BOT_TOKEN=TOKEN_DO_BOT_CODEPRO
```

O bot deve estar no servidor do canal com **Ver canal + Gerenciar Webhooks**.

## 6. Cliente por cargo do Discord (opcional)

Você pode configurar:

```env
DISCORD_GUILD_ID=ID_DO_SERVIDOR
CLIENT_ROLE_ID=ID_DO_CARGO_CLIENTE
DISCORD_BOT_TOKEN=TOKEN_DO_BOT
```

Isso ajuda o site a reconhecer visualmente que a pessoa é cliente. O acesso aos painéis continua sendo definido por Discord ID na aba **Clientes**.

## Estrutura

```text
CodePro-Site-V1/
├── server.js
├── package.json
├── .env.example
├── lib/
├── public/
└── data/
```

## Hospedagem

Startup:

```text
node server.js
```

Se o painel não carrega `.env` sozinho e estiver em Node 20+:

```text
node --env-file=.env server.js
```
