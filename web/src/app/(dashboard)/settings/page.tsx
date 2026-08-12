'use client';
import { useState, useEffect } from 'react';
import { api, User, Org } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

// ─── Design tokens ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#111118', borderRadius: 10, padding: '1.5rem',
  border: '1px solid #1e1e2a', marginBottom: '1rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.875rem', borderRadius: 7, border: '1px solid #252532',
  fontSize: '0.875rem', background: '#0d0d14', color: '#f1f5f9',
  width: '100%', outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.125rem', background: '#6366f1', color: '#fff', border: 'none',
  borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
  boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500,
};

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '0.75rem 0', borderBottom: '1px solid #1a1a24', alignItems: 'baseline' }}>
      <div style={{ width: 140, fontSize: '0.78rem', color: '#64748b', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '0.875rem', color: '#e2e8f0', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value || '—'}</div>
    </div>
  );
}

function onFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = '#6366f1';
  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
}
function onBlur(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = '#252532';
  e.target.style.boxShadow = 'none';
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const orgId = getStoredOrgId();
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [webhookSuccess, setWebhookSuccess] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [avoidBloodMoonRestart, setAvoidBloodMoonRestart] = useState(false);
  const [restartGuardSaving, setRestartGuardSaving] = useState(false);
  const [restartGuardMessage, setRestartGuardMessage] = useState('');
  const [discordBotCopied, setDiscordBotCopied] = useState(false);
  const [uiTheme, setUiTheme] = useState<'original'|'dark'|'light'>('original');

  const discordBotEnvironment = `DISCORD_TOKEN=<Bot token from Discord Developer Portal>
DISCORD_CLIENT_ID=<Discord Application ID>
DISCORD_GUILD_ID=<Your Discord server ID>
DISCORD_ALLOWED_ROLE_IDS=<Optional comma-separated role IDs>
DISCORD_ALLOWED_USER_IDS=<Optional comma-separated user IDs>
DISCORD_EPHEMERAL_REPLIES=true
MASTERMIND_URL=http://control-plane:3001
MASTERMIND_EMAIL=<Dedicated Mastermind operator email>
MASTERMIND_PASSWORD=<Dedicated Mastermind operator password>
MASTERMIND_ORG_ID=${orgId || '<Mastermind organization ID>'}
MASTERMIND_SERVER_ID=<Optional; blank auto-detects the first 7DTD server>
JOB_TIMEOUT_SECONDS=600`;

  useEffect(() => {
    const saved=localStorage.getItem('mm_ui_theme');
    if(saved==='dark'||saved==='light'||saved==='original')setUiTheme(saved);
  }, []);

  function applyUiTheme(theme:'original'|'dark'|'light') {
    setUiTheme(theme);
    localStorage.setItem('mm_ui_theme',theme);
    document.documentElement.dataset.theme=theme;
    window.dispatchEvent(new Event('mastermind-theme-change'));
  }

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      api.get<User>('/api/auth/me'),
      api.get<Org[]>('/api/orgs').then(orgs => orgs.find(o => o.id === orgId) || null).catch(() => null),
    ])
      .then(([u, o]) => { setUser(u); setOrg(o); setWebhookUrl(o?.discordWebhookUrl||''); setAvoidBloodMoonRestart(Boolean(o?.avoidBloodMoonRestart)); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [orgId]);

  async function handleUpdateWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setWebhookLoading(true); setWebhookError(''); setWebhookSuccess('');
    try {
      await api.patch(`/api/orgs/${orgId}`, { discordWebhookUrl: webhookUrl });
      setWebhookSuccess('Discord webhook updated successfully.');
    } catch (err: unknown) {
      setWebhookError(err instanceof Error ? err.message : 'Failed to update webhook');
    } finally {
      setWebhookLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault(); setPasswordError(''); setPasswordSuccess('');
    if (newPassword.length < 12) { setPasswordError('New password must be at least 12 characters.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('New passwords do not match.'); return; }
    setPasswordLoading(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setPasswordSuccess('Password changed successfully.');
    } catch (err) { setPasswordError(err instanceof Error ? err.message : 'Password change failed'); }
    finally { setPasswordLoading(false); }
  }

  async function handleRestartGuard(enabled:boolean) {
    if (!orgId) return;
    setRestartGuardSaving(true); setRestartGuardMessage('');
    try {
      const saved=await api.patch<{ok:boolean;avoidBloodMoonRestart:boolean}>(`/api/orgs/${orgId}`, { avoidBloodMoonRestart: enabled });
      setAvoidBloodMoonRestart(saved.avoidBloodMoonRestart);
      setRestartGuardMessage(saved.avoidBloodMoonRestart ? 'Blood Moon restart protection enabled.' : 'Blood Moon restart protection disabled.');
    } catch (err) {
      setRestartGuardMessage(err instanceof Error ? err.message : 'Failed to save restart protection');
    } finally { setRestartGuardSaving(false); }
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Settings</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Manage your organisation and account</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Org Info */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Organisation</h2>
        {loading ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</p>
        ) : org ? (
          <div>
            <InfoRow label="Name" value={org.name} />
            <InfoRow label="Slug" value={org.slug} mono />
            <InfoRow label="Org ID" value={org.id} mono />
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
            Org ID: <code style={{ fontFamily: 'monospace', color: '#818cf8' }}>{orgId || '—'}</code>
          </p>
        )}
      </div>

      {/* Appearance */}
      <div style={card}>
        <h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>Appearance</h2>
        <p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Choose how Mastermind looks on this browser. The setting applies immediately and does not affect other users.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10}}>
          {([
            ['original','Original UI','Purple-black Mastermind colors','#111118','#6366f1'],
            ['dark','Dark UI','Neutral charcoal and slate','#0f172a','#38bdf8'],
            ['light','Light UI','Bright panels and dark text','#f8fafc','#2563eb'],
          ] as const).map(([value,title,description,background,accent])=><button key={value} type="button" onClick={()=>applyUiTheme(value)} aria-pressed={uiTheme===value} style={{textAlign:'left',padding:12,borderRadius:8,cursor:'pointer',background,border:`2px solid ${uiTheme===value?accent:'#334155'}`,color:value==='light'?'#0f172a':'#f1f5f9',boxShadow:uiTheme===value?`0 0 0 2px ${accent}33`:'none'}}><span style={{display:'block',fontWeight:700,marginBottom:4}}>{title}{uiTheme===value?' ✓':''}</span><span style={{display:'block',fontSize:'.72rem',opacity:.75}}>{description}</span><span style={{display:'flex',gap:4,marginTop:9}}><i style={{width:20,height:8,borderRadius:4,background:accent}}/><i style={{width:20,height:8,borderRadius:4,background:value==='light'?'#cbd5e1':'#334155'}}/></span></button>)}
        </div>
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>7DTD Restart Protection</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>
          When enabled, restart jobs check the live in-game day. On days divisible by 7, the job waits and restarts after the next in-game day begins.
        </p>
        <label style={{display:'flex',alignItems:'center',gap:10,color:'#e2e8f0',fontSize:'.875rem',cursor:restartGuardSaving?'wait':'pointer'}}>
          <input type="checkbox" checked={avoidBloodMoonRestart} disabled={restartGuardSaving} onChange={e=>void handleRestartGuard(e.target.checked)} />
          Do not restart during Blood Moon days <strong style={{color:avoidBloodMoonRestart?'#4ade80':'#64748b'}}>({avoidBloodMoonRestart?'Enabled':'Disabled'})</strong>
        </label>
        {restartGuardMessage&&<p style={{color:restartGuardMessage.includes('enabled')||restartGuardMessage.includes('disabled')?'#4ade80':'#f87171',fontSize:'.8rem',marginBottom:0}}>{restartGuardMessage}</p>}
      </div>

      {/* Discord Webhook */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Discord Webhook</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
          Set a Discord webhook URL to receive notifications for alerts and important events.
        </p>
        <form onSubmit={handleUpdateWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label style={labelStyle}>Webhook URL</label>
            <input
              style={inputStyle}
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>
          {webhookError && <p style={{ color: '#f87171', margin: 0, fontSize: '0.8rem' }}>{webhookError}</p>}
          {webhookSuccess && <p style={{ color: '#4ade80', margin: 0, fontSize: '0.8rem' }}>{webhookSuccess}</p>}
          <div>
            <button type="submit" style={btnPrimary} disabled={webhookLoading}>
              {webhookLoading ? 'Saving…' : 'Save Webhook'}
            </button>
          </div>
        </form>
      </div>

      {/* Discord Bot */}
      <div style={card} id="discord-bot">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:16,flexWrap:'wrap'}}>
          <div><h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>Discord Bot</h2><p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Let trusted Discord staff start, stop, or restart this server. The bot tells them when the action succeeds or fails.</p></div>
          <a href="/downloads/Mastermind-Discord-Bot-0.1.0.zip" download style={{...btnPrimary,textDecoration:'none',display:'inline-block',flexShrink:0}}>Download bot v0.1.0</a>
        </div>

        <h3 style={{color:'#e2e8f0',fontSize:'.9rem',margin:'1rem 0 .5rem'}}>What you need</h3>
        <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:'.8rem'}}><tbody>
          {[
            ['DISCORD_TOKEN','The bot password. Copy it from Developer Portal → Bot → Reset Token. Keep it secret.'],
            ['DISCORD_CLIENT_ID','The bot Application ID from Developer Portal → General Information.'],
            ['DISCORD_GUILD_ID','Your Discord server ID. This makes commands appear immediately.'],
            ['DISCORD_ALLOWED_ROLE_IDS','Discord role IDs for staff allowed to use the commands. Separate multiple IDs with commas.'],
            ['MASTERMIND_EMAIL / PASSWORD','The Mastermind account the bot will use to create server jobs.'],
            ['MASTERMIND_ORG_ID',orgId||'Organization ID shown at the top of this Settings page.'],
            ['MASTERMIND_SERVER_ID','Optional. Leave blank to use the first registered 7DTD server.'],
          ].map(([name,description])=><tr key={name}><td style={{padding:'.55rem',borderBottom:'1px solid #1e1e2a',color:'#818cf8',fontFamily:'monospace',whiteSpace:'nowrap'}}>{name}</td><td style={{padding:'.55rem',borderBottom:'1px solid #1e1e2a',color:'#94a3b8'}}>{description}</td></tr>)}
        </tbody></table></div>

        <h3 style={{color:'#e2e8f0',fontSize:'.9rem',margin:'1.25rem 0 .5rem'}}>Setup for first-time users</h3>
        <p style={{color:'#94a3b8',fontSize:'.82rem',lineHeight:1.6}}>Allow about 20 minutes. You need a Discord account, a Discord server you own or manage, and the ability to install Node.js on the computer that runs Mastermind. An ID is only a long number that Discord uses to identify a server, role, or person.</p>
        <div style={{background:'#0a0a12',border:'1px solid #252532',borderRadius:7,padding:'.75rem .85rem',marginBottom:8,color:'#cbd5e1',fontSize:'.8rem',lineHeight:1.55}}><strong>Before copying anything:</strong> Open Notepad and create a temporary file named <code>Mastermind Bot Setup Notes.txt</code> in your Documents folder. Each instruction below tells you which label to put before a copied value. These labels match the lines in the bot&apos;s <code>.env</code> configuration file. The notes prevent values from being lost while moving between Discord and Mastermind. Delete this temporary notes file after the bot works because it contains passwords.</div>
        {[
          ['1. Make a Discord server (skip if you already have one)',<ol key="server"><li>Open Discord and click the <strong>+</strong> button on the far-left server list.</li><li>Choose <strong>Create My Own</strong>, then <strong>For me and my friends</strong>.</li><li>Name it anything you like. You are now its owner.</li></ol>],
          ['2. Create the bot',<ol key="create"><li>Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" style={{color:'#818cf8'}}>Discord Developer Portal</a> and sign in with Discord.</li><li>Click <strong>New Application</strong>, enter <code>Mastermind</code>, accept the terms, and click <strong>Create</strong>.</li><li>On <strong>General Information</strong>, copy <strong>Application ID</strong>. In your temporary setup-notes file, add a new line containing <code>DISCORD_CLIENT_ID=</code> and paste the number after the equals sign.</li><li>Click <strong>Bot</strong> on the left, then <strong>Reset Token</strong>. Copy the token. Add a line containing <code>DISCORD_TOKEN=</code> to the same notes file and paste the token after it. Treat this file like a password.</li></ol>],
          ['3. Invite the bot',<ol key="invite"><li>In the Developer Portal, click <strong>OAuth2</strong>, then <strong>URL Generator</strong>.</li><li>Under Scopes, check <code>bot</code> and <code>applications.commands</code>.</li><li>Under Bot Permissions, check <strong>Send Messages</strong> and <strong>Use Application Commands</strong>.</li><li>Copy the generated URL at the bottom, open it in a browser, select your Discord server, and click <strong>Authorize</strong>.</li></ol>],
          ['4. Copy your Discord server ID',<ol key="ids"><li>In the Discord desktop app, click the gear beside your name.</li><li>Open <strong>Advanced</strong> and turn on <strong>Developer Mode</strong>.</li><li>Close Settings, right-click your server icon, and click <strong>Copy Server ID</strong>. In the same setup-notes file, add <code>DISCORD_GUILD_ID=</code> and paste the number after it.</li><li>For the simplest safe setup, right-click your own name and click <strong>Copy User ID</strong>. Add <code>DISCORD_ALLOWED_USER_IDS=</code> to the notes and paste the number after it. This setting allows only you to use the bot.</li></ol>],
          ['5. Create the bot’s Mastermind account',<ol key="mastermind"><li><strong>Why:</strong> The Discord bot signs into Mastermind to perform commands. Its own account makes Discord actions easy to identify on the Jobs page.</li><li>Open <a href="/accounts" style={{color:'#818cf8'}}><strong>Accounts</strong></a> from Mastermind&apos;s left menu and find <strong>Create account</strong>.</li><li>Enter <code>Discord Bot</code> for the display name. Enter a unique email-style login and create a password containing at least 12 characters.</li><li>For Access level, select <strong>Operator — can control servers</strong>, then click <strong>Create account</strong>.</li><li>In your setup notes, add <code>MASTERMIND_EMAIL=</code> and <code>MASTERMIND_PASSWORD=</code> using the login you just created.</li><li>Return to <strong>Settings</strong>. In the Organization box at the top, copy <strong>Org ID</strong>. Add <code>MASTERMIND_ORG_ID=</code> and paste it after the equals sign.</li><li>Add <code>MASTERMIND_SERVER_ID=</code> and leave it empty if you have only one 7DTD server. The bot selects that server automatically.</li></ol>],
          ['6. Download and fill in the real configuration file',<ol key="file"><li>Click <strong>Download bot v0.1.0</strong> above. Right-click the ZIP in Downloads, choose <strong>Extract All</strong>, then open the extracted folder.</li><li>In File Explorer, enable <strong>View → Show → File name extensions</strong>.</li><li>Rename <code>.env.example</code> to <code>.env</code>. Confirm the name change, then open it with Notepad. This <code>.env</code> file is where the bot actually reads its settings when it starts.</li><li>Copy the values from your temporary setup-notes file into the matching lines in <code>.env</code>. Do not add spaces around <code>=</code>. Save <code>.env</code>.</li><li>After the bot passes the test in step 8, delete <code>Mastermind Bot Setup Notes.txt</code>. Keep <code>.env</code>; the bot needs it each time it starts.</li></ol>],
          ['7. Start it on Windows',<ol key="start"><li>Install <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer" style={{color:'#818cf8'}}>Node.js LTS</a> using the normal Windows installer and its default choices.</li><li>Open the extracted bot folder. Click the File Explorer address bar, type <code>powershell</code>, and press Enter.</li><li>Run <code>npm install --omit=dev</code>. Wait until it finishes.</li><li>Run <code>Get-Content .env | ForEach-Object {'{'} if ($_ -match '^([^#=]+)=(.*)$') {'{'} [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') {'}'} {'}'}; npm start</code>.</li><li>Leave that PowerShell window open. A message saying the bot logged in means it is running.</li></ol>],
          ['8. Test it',<ol key="test"><li>Return to your Discord server and type <code>/start</code>.</li><li>Select the Mastermind command. The bot should say it is waiting, then report success or failure.</li><li>Try <code>/safereboot</code> only when you actually want the game server to restart.</li></ol>],
        ].map(([title,body])=><details key={String(title)} style={{border:'1px solid #252532',borderRadius:7,padding:'.7rem .85rem',marginBottom:8,color:'#94a3b8',fontSize:'.82rem',lineHeight:1.65}}><summary style={{cursor:'pointer',color:'#e2e8f0',fontWeight:600}}>{title}</summary><div style={{marginTop:8}}>{body}</div></details>)}

        <div style={{position:'relative'}}><pre style={{background:'#09090f',border:'1px solid #252532',borderRadius:7,padding:'1rem',color:'#cbd5e1',fontSize:'.72rem',overflowX:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{discordBotEnvironment}</pre><button type="button" style={{...btnPrimary,position:'absolute',right:8,top:8,padding:'.35rem .65rem',fontSize:'.72rem'}} onClick={()=>{void navigator.clipboard.writeText(discordBotEnvironment);setDiscordBotCopied(true);setTimeout(()=>setDiscordBotCopied(false),1800);}}>{discordBotCopied?'Copied':'Copy configuration'}</button></div>
        <p style={{color:'#fbbf24',fontSize:'.75rem',marginBottom:0}}>Keep the Discord token and Mastermind password out of screenshots, chat, Git, and support logs. If exposed, reset the Discord token immediately.</p>
      </div>

      {/* Agent Pairing */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Agent Pairing</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
          To register a new host agent, generate a pairing token from the Hosts page.
        </p>
        <a href="/hosts" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>
          Go to Hosts →
        </a>
      </div>

      {/* Account */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Account</h2>
        {loading ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</p>
        ) : user ? (
          <div>
            <InfoRow label="Email" value={user.email} />
            {user.name && <InfoRow label="Name" value={user.name} />}
            <InfoRow label="User ID" value={user.id} mono />
            <form onSubmit={handleChangePassword} style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'.875rem',marginTop:'1.25rem'}}>
              <div><label style={labelStyle}>Current password</label><input style={inputStyle} type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required onFocus={onFocus} onBlur={onBlur}/></div>
              <div><label style={labelStyle}>New password</label><input style={inputStyle} type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required onFocus={onFocus} onBlur={onBlur}/></div>
              <div><label style={labelStyle}>Confirm new password</label><input style={inputStyle} type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required onFocus={onFocus} onBlur={onBlur}/></div>
              <div style={{gridColumn:'1 / -1'}}>
                {passwordError&&<p style={{color:'#f87171',fontSize:'.8rem'}}>{passwordError}</p>}
                {passwordSuccess&&<p style={{color:'#4ade80',fontSize:'.8rem'}}>{passwordSuccess}</p>}
                <button type="submit" style={btnPrimary} disabled={passwordLoading}>{passwordLoading?'Changing…':'Change Password'}</button>
              </div>
            </form>
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Could not load user info.</p>
        )}
      </div>
    </div>
  );
}
