# Mastermind Discord Bot — Easy Setup

This bot lets approved Discord members control your 7 Days to Die server:

- `/start` — start the server
- `/stop` — safely stop the server
- `/reboot` — restart the server
- `/safereboot` — warn players, save, back up, kick everyone, then restart

The bot replies when Mastermind finishes or if the action fails.

## Before you begin

You need:

- permission to create a Discord bot;
- a Mastermind login that can control the server;
- Docker, or Node.js 20 or newer.

## Part 1: Create the Discord bot

1. Visit <https://discord.com/developers/applications>.
2. Click **New Application**, enter `Mastermind`, then click **Create**.
3. On **General Information**, copy **Application ID**. This is your `DISCORD_CLIENT_ID`.
4. Click **Bot** in the left menu.
5. Click **Reset Token**, confirm, then copy the token. This is `DISCORD_TOKEN`.
6. Keep the token secret. Anyone with it can control the bot.

## Part 2: Invite it to your Discord server

1. In the Developer Portal, open **OAuth2 → URL Generator**.
2. Check `bot` and `applications.commands`.
3. Under bot permissions, check **Send Messages** and **Use Application Commands**.
4. Open the generated URL and choose your Discord server.

## Part 3: Copy your server and role IDs

1. In Discord, open **User Settings → Advanced**.
2. Turn on **Developer Mode**.
3. Right-click your Discord server and choose **Copy Server ID**. This is `DISCORD_GUILD_ID`.
4. To choose who can run commands, right-click an allowed role and choose **Copy Role ID**.
5. Put multiple allowed role IDs on one line separated by commas:

```env
DISCORD_ALLOWED_ROLE_IDS=111111111111111111,222222222222222222
```

When this line contains role IDs, members without one of those roles are denied. You can also allow specific people with `DISCORD_ALLOWED_USER_IDS`.

## Part 4: Connect it to Mastermind

Use a dedicated Mastermind operator account if possible. Its name will appear on the Jobs page for every Discord action.

1. Copy `.env.example` to a new file named `.env`.
2. Open `.env` in a text editor.
3. Fill in the Discord values from Parts 1–3.
4. Set `MASTERMIND_EMAIL` and `MASTERMIND_PASSWORD` to the bot’s Mastermind login.
5. Set `MASTERMIND_ORG_ID` to the ID shown on Mastermind’s Settings page.
6. Leave `MASTERMIND_SERVER_ID` blank if you have one 7DTD server.

Do not add quotes unless the value itself contains spaces.

## Part 5: Start the bot

### Docker Compose

From the Mastermind repository:

```sh
docker compose --env-file discord-bot/.env -f infra/docker-compose.yml --profile discord-bot up -d discord-bot
docker compose -f infra/docker-compose.yml logs -f discord-bot
```

### Standalone Node.js

From the extracted `discord-bot` folder:

```sh
npm install --omit=dev
```

Load the values from `.env` using your operating system or secret manager, then run:

```sh
npm start
```

## Test it

1. Return to your Discord server.
2. Type `/start` and select the Mastermind command.
3. The bot should first say it is waiting for Mastermind.
4. The same message will change to success or failure when the job finishes.

If commands do not appear, confirm `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID`, then restart the bot.

## Security

- Never post or commit `.env`.
- Never share `DISCORD_TOKEN` or the Mastermind password.
- If the Discord token is exposed, reset it in **Developer Portal → Bot**.
- Use `DISCORD_ALLOWED_ROLE_IDS` so only trusted staff can control the server.
