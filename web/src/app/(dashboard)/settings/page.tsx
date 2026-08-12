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

        <h3 style={{color:'#e2e8f0',fontSize:'.9rem',margin:'1.25rem 0 .5rem'}}>Quick setup</h3>
        <ol style={{color:'#94a3b8',fontSize:'.82rem',lineHeight:1.65,paddingLeft:'1.25rem'}}>
          <li><strong>Create:</strong> Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" style={{color:'#818cf8'}}>Discord Developer Portal</a>, click <strong>New Application</strong>, and name it Mastermind.</li>
          <li><strong>Copy:</strong> Copy <strong>Application ID</strong> from General Information. Then open Bot → Reset Token and copy the secret token.</li>
          <li><strong>Invite:</strong> Open OAuth2 → URL Generator. Check <code>bot</code> and <code>applications.commands</code>, then allow Send Messages and Use Application Commands.</li>
          <li><strong>Choose staff:</strong> Enable Discord Developer Mode. Right-click your server to copy its ID, then right-click each trusted staff role to copy its role ID.</li>
          <li><strong>Connect:</strong> Extract the download, rename <code>.env.example</code> to <code>.env</code>, and replace the bracketed values in the configuration below.</li>
          <li><strong>Start and test:</strong> Follow the included Docker or Node instructions, then type <code>/start</code> in Discord.</li>
        </ol>

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
