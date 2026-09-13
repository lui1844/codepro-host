'use strict';

async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const r = await fetch('https://discord.com/api/v10/oauth2/token', {
    method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded' }, body:params,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.error || 'oauth_token_failed');
  return data;
}

async function getUser(accessToken) {
  const r = await fetch('https://discord.com/api/v10/users/@me', { headers:{ authorization:`Bearer ${accessToken}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'discord_user_failed');
  return data;
}

async function getGuildMember({ botToken, guildId, userId }) {
  if (!botToken || !guildId || !userId) return null;
  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    headers:{ authorization:`Bot ${botToken}` },
  });
  if (r.status === 404) return null;
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'guild_member_failed');
  return data;
}

async function ensureWebhook({ botToken, channelId, name='CodePro HaxBall' }) {
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN_not_configured');
  const headers = { authorization:`Bot ${botToken}`, 'content-type':'application/json' };
  let r = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, { headers:{ authorization:`Bot ${botToken}` } });
  if (!r.ok) { const d=await r.json().catch(()=>({})); throw new Error(d.message || 'webhook_list_failed'); }
  const list = await r.json();
  let hook = list.find(h => h.name === name && h.token);
  if (!hook) {
    r = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
      method:'POST', headers, body:JSON.stringify({ name }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'webhook_create_failed');
    hook = d;
  }
  if (!hook.token) throw new Error('webhook_token_unavailable');
  return `https://discord.com/api/webhooks/${hook.id}/${hook.token}`;
}

module.exports = { exchangeCode, getUser, getGuildMember, ensureWebhook };
