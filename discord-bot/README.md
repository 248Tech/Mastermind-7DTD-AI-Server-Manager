# Mastermind Discord Bot — Beginner Setup

This bot puts four Mastermind controls into Discord:

- `/start` starts the 7 Days to Die server.
- `/stop` safely stops it.
- `/reboot` restarts it immediately.
- `/safereboot` warns players, saves and backs up the world, kicks players, and restarts.

The bot waits for Mastermind and tells you whether the job succeeded. Allow about 20 minutes for setup.

## What you need

- A Discord account.
- A Discord server you own or are allowed to manage. A Discord “server” is simply a private group/community inside Discord.
- A Mastermind login allowed to control the game server.
- The downloaded bot ZIP.
- For the easiest Windows setup, Node.js LTS. Docker is optional.

An **ID** is only a long number Discord uses to identify a server, role, or person. A **token** is the bot's secret password.

## Before copying values: make one temporary notes file

Several steps ask you to copy long values. They will eventually go into the bot's `.env` configuration file, but that file is inside the download you may not have opened yet.

1. Open Notepad.
2. Choose **File → Save As**.
3. Open your **Documents** folder.
4. Name the file `Mastermind Bot Setup Notes.txt` and click **Save**.
5. Keep this file open while following the guide.

When an instruction gives you a label such as `DISCORD_CLIENT_ID=`, type that label on a new line and paste the copied value after the equals sign. The label tells you which line the value belongs on later. Delete this temporary notes file after the bot works because it will contain passwords.

## 1. Make a Discord server

Skip this section if you already own or manage one.

1. Open Discord.
2. Click the **+** button on the far-left server list.
3. Choose **Create My Own**.
4. Choose **For me and my friends**.
5. Give it any name and click **Create**.

## 2. Create the bot

1. Open <https://discord.com/developers/applications> and sign in.
2. Click **New Application**.
3. Enter `Mastermind`, accept Discord's terms, and click **Create**.
4. The **General Information** page opens. Find **Application ID** and click **Copy**. In `Mastermind Bot Setup Notes.txt`, add `DISCORD_CLIENT_ID=` and paste the number after the equals sign.
5. Click **Bot** in the left menu.
6. Under Token, click **Reset Token**, approve the prompt, and click **Copy**.
7. In the same notes file, add `DISCORD_TOKEN=` and paste the token after the equals sign.

Never send the token to anyone. If it is exposed, return to this page and reset it again.

## 3. Invite the bot to your Discord server

1. In the Developer Portal, click **OAuth2**, then **URL Generator**.
2. Under **Scopes**, check `bot` and `applications.commands`.
3. A **Bot Permissions** section appears. Check **Send Messages** and **Use Application Commands**.
4. Scroll to the generated URL, click **Copy**, and open it in your browser.
5. Select your Discord server, click **Continue**, then **Authorize**.
6. The bot may appear offline. That is normal until you start its program later.

## 4. Copy the Discord IDs

1. In the Discord desktop app, click the gear beside your name.
2. Click **Advanced** and turn on **Developer Mode**.
3. Close Settings.
4. Right-click your Discord server icon and choose **Copy Server ID**. In the notes file, add `DISCORD_GUILD_ID=` and paste the number after it. This tells the bot which Discord server should receive the commands.
5. For the simplest safe setup, right-click your own name and choose **Copy User ID**. Add `DISCORD_ALLOWED_USER_IDS=` to the notes and paste the number after it. This allows only you to run commands.

Later, you can allow a staff role instead: open **Server Settings → Roles**, right-click the role, and choose **Copy Role ID**. Put that number in `DISCORD_ALLOWED_ROLE_IDS`. Separate multiple IDs with commas and no spaces.

## 5. Give the bot a Mastermind login

### Why this is needed

Discord cannot control the game server by itself. When someone uses `/start`, the Discord bot must sign into Mastermind and ask Mastermind to start the server. Giving the bot its own login also makes the Mastermind Jobs page identify commands that came from Discord.

### Create the login without signing out

1. In Mastermind's left menu, click **Accounts**.
2. Find the **Create account** box.
3. In **Display name**, enter `Discord Bot`.
4. In **Email used to sign in**, enter a unique email-style login you will recognize. It must be different from every existing Mastermind account.
5. Enter a password containing at least 12 characters in both password boxes.
6. For **Access level**, select **Operator — can control servers**.
7. Click **Create account**. A green confirmation message appears and the new account is added to the table below.

You remain signed into your normal administrator account. The bot account is automatically connected to the same organization and Operator gives it the normal controls needed for `/start`, `/stop`, `/reboot`, and `/safereboot`.

### Record the three Mastermind settings

1. In `Mastermind Bot Setup Notes.txt`, add `MASTERMIND_EMAIL=` followed by the email-style login you just created.
2. Add `MASTERMIND_PASSWORD=` followed by its password. Mastermind does not display this password again.
3. In Mastermind's left menu, click **Settings**.
4. At the top of Settings, find the **Organization** box and its **Org ID** row.
5. Add `MASTERMIND_ORG_ID=` to the notes and paste the displayed Org ID after it. This tells the bot which group of servers it may control.
6. If Mastermind has only one registered 7DTD server, add `MASTERMIND_SERVER_ID=` and leave the rest of the line empty. The bot selects that server automatically.

## 6. Fill in the configuration file

1. Right-click the downloaded ZIP and choose **Extract All**.
2. Open the extracted folder.
3. In File Explorer, enable **View → Show → File name extensions**.
4. Rename `.env.example` to `.env`. Make sure Windows did not name it `.env.txt`.
5. Right-click `.env`, choose **Open with**, and select Notepad.
6. The `.env` file is the real configuration file that the bot reads whenever it starts. Copy each complete line from `Mastermind Bot Setup Notes.txt` over the matching line in `.env`. Do not add spaces around `=` and do not add quotation marks.
7. Save `.env`. Keep this file in the extracted bot folder because the bot needs it each time it starts.
8. After the bot passes the test later in this guide, delete `Mastermind Bot Setup Notes.txt` from Documents. It was only temporary and contains sensitive values.

Example with fake values:

```env
DISCORD_TOKEN=fake.secret.bot-token
DISCORD_CLIENT_ID=123456789012345678
DISCORD_GUILD_ID=234567890123456789
DISCORD_ALLOWED_ROLE_IDS=
DISCORD_ALLOWED_USER_IDS=345678901234567890
DISCORD_EPHEMERAL_REPLIES=true
MASTERMIND_URL=http://127.0.0.1:3001
MASTERMIND_EMAIL=discord-bot@example.com
MASTERMIND_PASSWORD=replace-this-with-your-password
MASTERMIND_ORG_ID=replace-this-with-the-org-id
MASTERMIND_SERVER_ID=
JOB_TIMEOUT_SECONDS=600
```

Use `MASTERMIND_URL=http://127.0.0.1:3001` when the standalone bot runs on the same computer as Mastermind. If it runs elsewhere, use the Mastermind API address reachable from that computer.

## 7. Start it on Windows

1. Download and install **Node.js LTS** from <https://nodejs.org/en/download>. Accept the normal installer defaults.
2. Open the extracted bot folder in File Explorer.
3. Click the address bar, type `powershell`, and press Enter. PowerShell opens in the correct folder.
4. Paste this command and press Enter:

```powershell
npm install --omit=dev
```

5. After it finishes, paste this command and press Enter:

```powershell
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') } }; npm start
```

6. Leave the PowerShell window open. A message saying the bot logged in means it is running. Closing the window stops the bot.

## 8. Test it

1. Return to your Discord server.
2. Type `/start` and select the Mastermind command.
3. Discord should first show that Mastermind is working, then show success or failure.
4. Use `/safereboot` only when you truly want to restart the game server.

## Docker setup (advanced alternative)

From the Mastermind repository:

```sh
docker compose --env-file discord-bot/.env -f infra/docker-compose.yml --profile discord-bot up -d discord-bot
docker compose -f infra/docker-compose.yml logs -f discord-bot
```

When using Compose, set `MASTERMIND_URL=http://control-plane:3001`.

## Common problems

- **Commands do not appear:** check `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID`, then stop and restart the bot. Also confirm the invite included `applications.commands`.
- **Bot looks offline:** its PowerShell window or container is not running, or `DISCORD_TOKEN` is wrong.
- **You are denied:** confirm your User ID is in `DISCORD_ALLOWED_USER_IDS`, or your role ID is in `DISCORD_ALLOWED_ROLE_IDS`.
- **Mastermind login failed:** sign into the Mastermind website using the same email/password. Correct `.env`, then restart the bot.
- **No server was found:** confirm the 7DTD server appears in Mastermind. If several exist, put the intended instance ID in `MASTERMIND_SERVER_ID`.
- **PowerShell says `npm` is unknown:** install Node.js LTS, close PowerShell, then open a new PowerShell window.
- **`.env` values seem ignored:** confirm the file is named exactly `.env`, not `.env.txt`, and restart the bot after every edit.

## Safety

- Never post or commit `.env`.
- Never share `DISCORD_TOKEN` or the Mastermind password.
- Restrict commands with allowed user or role IDs.
- Use a dedicated Mastermind bot account when possible.
- If the Discord token is exposed, reset it immediately in **Developer Portal → Bot** and update `.env`.
