export function renderDashboardUserAccess(): string {
  return `<script>
(function(){
  function showUserAccessView(){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav button,.mobile-nav button').forEach(b=>b.classList.remove('active'));
    document.getElementById('view-user-access')?.classList.add('active');
    document.querySelectorAll('[data-user-access-nav]').forEach(b=>b.classList.add('active'));
    window.__wbLoadUserAccess?.();
  }

  function installNav(){
    ['nav','mobileNav'].forEach(id=>{
      const root=document.getElementById(id);
      if(root && !root.querySelector('[data-user-access-nav]')){
        const b=document.createElement('button');
        b.type='button';
        b.dataset.userAccessNav='';
        b.textContent='👥 Users & Access';
        b.addEventListener('click',showUserAccessView);
        root.appendChild(b);
      }
    });
  }

  let accessData = { users: [], stats: {}, policy: null };
  let allAvailableModels = [];

  async function loadModelsForDropdown() {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      allAvailableModels = (data.models || []).filter(m => m.enabled && !m.roles.includes('embedding'));
    } catch (_) {}
  }

  async function loadUserAccess() {
    const list = document.getElementById('wbUserAccessList');
    if(!list) return;
    try {
      list.innerHTML = '<tr><td colspan="7" class="empty">Loading user profiles and quotas…</td></tr>';
      const [accRes] = await Promise.all([
        fetch('/api/access/users').then(r=>r.json()),
        loadModelsForDropdown()
      ]);

      if (accRes.success) {
        accessData = accRes;
        renderKpis(accRes.stats);
        renderPolicySettings(accRes.policy);
        renderUserTable(accRes.users);
      } else {
        list.innerHTML = '<tr><td colspan="7" class="empty" style="color:var(--red)">' + (accRes.error || 'Failed to load user access data') + '</td></tr>';
      }
    } catch (e) {
      list.innerHTML = '<tr><td colspan="7" class="empty" style="color:var(--red)">Error loading users: ' + e.message + '</td></tr>';
    }
  }

  function renderKpis(stats) {
    const total = document.getElementById('uaStatTotal');
    const vip = document.getElementById('uaStatVip');
    const pro = document.getElementById('uaStatPro');
    const today = document.getElementById('uaStatToday');
    if (total) total.textContent = stats.totalUsers ?? '0';
    if (vip) vip.textContent = stats.vipUsers ?? '0';
    if (pro) pro.textContent = stats.proUsers ?? '0';
    if (today) today.textContent = (stats.requestsTodayTotal ?? '0') + ' req (' + (stats.activeToday ?? '0') + ' active)';
  }

  function renderPolicySettings(pol) {
    if (!pol) return;
    const defTier = document.getElementById('uaPolicyDefaultTier');
    const whitelist = document.getElementById('uaPolicyWhitelist');
    const freeQuota = document.getElementById('uaPolicyFreeQuota');
    const proQuota = document.getElementById('uaPolicyProQuota');
    if (defTier) defTier.value = pol.defaultTier || 'free';
    if (whitelist) whitelist.value = pol.whitelistOnly ? 'true' : 'false';
    if (freeQuota) freeQuota.value = pol.tiers?.free?.dailyQuota ?? 30;
    if (proQuota) proQuota.value = pol.tiers?.pro?.dailyQuota ?? 150;
    
    if (document.getElementById('uaFreeContextLimit')) document.getElementById('uaFreeContextLimit').value = pol.tiers?.free?.contextHistoryLimit ?? 10;
    if (document.getElementById('uaProContextLimit')) document.getElementById('uaProContextLimit').value = pol.tiers?.pro?.contextHistoryLimit ?? 30;
    if (document.getElementById('uaVipContextLimit')) document.getElementById('uaVipContextLimit').value = pol.tiers?.vip?.contextHistoryLimit ?? 60;

    if (document.getElementById('uaProStars')) document.getElementById('uaProStars').value = pol.tiers?.pro?.starsAmount ?? 500;
    if (document.getElementById('uaVipStars')) document.getElementById('uaVipStars').value = pol.tiers?.vip?.starsAmount ?? 1250;

    if (document.getElementById('uaSupportContact')) document.getElementById('uaSupportContact').value = pol.supportContact || '@admin';
    if (document.getElementById('uaProPrice')) document.getElementById('uaProPrice').value = pol.tiers?.pro?.priceLabel || '$9.99 / month';
    if (document.getElementById('uaProCheckout')) document.getElementById('uaProCheckout').value = pol.tiers?.pro?.checkoutUrl || '';
    if (document.getElementById('uaProCrypto')) document.getElementById('uaProCrypto').value = pol.tiers?.pro?.cryptoCheckoutUrl || '';
    if (document.getElementById('uaVipPrice')) document.getElementById('uaVipPrice').value = pol.tiers?.vip?.priceLabel || '$24.99 / month';
    if (document.getElementById('uaVipCheckout')) document.getElementById('uaVipCheckout').value = pol.tiers?.vip?.checkoutUrl || '';
    if (document.getElementById('uaVipCrypto')) document.getElementById('uaVipCrypto').value = pol.tiers?.vip?.cryptoCheckoutUrl || '';
  }

  function getTierBadge(tier) {
    if (tier === 'vip') {
      return '<span class="pill" style="color:#ffd38c;border-color:rgba(245,183,79,.4);background:rgba(245,183,79,.14);font-weight:700">👑 VIP</span>';
    } else if (tier === 'pro') {
      return '<span class="pill" style="color:#80c5ff;border-color:rgba(90,167,255,.4);background:rgba(90,167,255,.14);font-weight:700">⚡ Pro</span>';
    }
    return '<span class="pill" style="color:#a0b4c8;border-color:rgba(142,162,184,.3);background:rgba(142,162,184,.08)">🌱 Free</span>';
  }

  function renderUserTable(users) {
    const list = document.getElementById('wbUserAccessList');
    const filterInput = document.getElementById('uaSearchInput');
    const filterText = (filterInput?.value || '').toLowerCase().trim();

    const filtered = users.filter(u => {
      if (!filterText) return true;
      const str = (u.displayName + ' ' + (u.username || '') + ' ' + u.telegramUserId + ' ' + u.tier + ' ' + u.status).toLowerCase();
      return str.includes(filterText);
    });

    if (!filtered.length) {
      list.innerHTML = '<tr><td colspan="7" class="empty">No users matched the criteria.</td></tr>';
      return;
    }

    list.innerHTML = filtered.map(u => {
      const isUnlimited = u.tier === 'vip' || u.dailyQuota < 0 || u.dailyQuota >= 999999;
      const pct = isUnlimited ? 0 : Math.min(100, Math.round((u.requestsToday / Math.max(1, u.dailyQuota)) * 100));
      const barColor = pct >= 90 ? 'var(--red)' : pct >= 65 ? 'var(--amber)' : 'var(--blue)';

      const quotaHtml = isUnlimited
        ? '<div style="font-weight:600;color:var(--amber)">Unlimited <span style="color:var(--muted);font-size:11px">(' + u.requestsToday + ' today)</span></div>'
        : '<div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span><strong>' + u.requestsToday + '</strong> / ' + u.dailyQuota + '</span><span style="color:var(--muted)">' + u.remainingToday + ' left</span></div><div style="background:#13273d;border-radius:4px;height:6px;width:120px;overflow:hidden"><div style="width:' + pct + '%;background:' + barColor + ';height:100%"></div></div></div>';

      const statusBadge = u.status === 'suspended'
        ? '<span class="pill bad">Suspended</span>'
        : u.status === 'whitelisted'
        ? '<span class="pill good">Whitelisted</span>'
        : '<span class="pill good">Active</span>';

      const modelOptions = [
        '<option value="">-- Dynamic Tier Default --</option>',
        ...allAvailableModels.map(m => '<option value="' + m.id + '" ' + (u.customModelOverride === m.id ? 'selected' : '') + '>' + m.provider + ': ' + m.modelId + '</option>')
      ].join('');

      return '<tr>' +
        '<td>' +
          '<div style="font-weight:700">' + (u.displayName.replace(/</g, '&lt;')) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);font-family:ui-monospace,monospace">ID: ' + u.telegramUserId + '</div>' +
        '</td>' +
        '<td>' +
          '<select class="select" style="padding:4px 8px;font-size:12px;width:105px" onchange="window.__wbChangeUserTier(' + u.telegramUserId + ', this.value)">' +
            '<option value="free" ' + (u.tier === 'free' ? 'selected' : '') + '>🌱 Free</option>' +
            '<option value="pro" ' + (u.tier === 'pro' ? 'selected' : '') + '>⚡ Pro</option>' +
            '<option value="vip" ' + (u.tier === 'vip' ? 'selected' : '') + '>👑 VIP</option>' +
          '</select>' +
        '</td>' +
        '<td>' + quotaHtml + '</td>' +
        '<td>' +
          '<select class="select" style="padding:4px 8px;font-size:12px;max-width:180px" onchange="window.__wbChangeUserModelOverride(' + u.telegramUserId + ', this.value)">' +
            modelOptions +
          '</select>' +
        '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' +
          '<div style="font-size:12px"><strong>' + (u.totalRequests || 0) + '</strong> reqs</div>' +
          '<div style="font-size:11px;color:var(--muted)">' + (new Date(u.lastActiveAt).toLocaleDateString()) + '</div>' +
        '</td>' +
        '<td>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
            '<button class="btn" style="padding:4px 8px;font-size:11px" onclick="window.__wbResetUserQuota(' + u.telegramUserId + ')" title="Reset requests count today">↺ Reset</button>' +
            '<button class="btn ' + (u.status === 'suspended' ? 'primary' : '') + '" style="padding:4px 8px;font-size:11px" onclick="window.__wbToggleUserStatus(' + u.telegramUserId + ')">' +
              (u.status === 'suspended' ? 'Activate' : 'Suspend') +
            '</button>' +
            '<button class="btn danger" style="padding:4px 8px;font-size:11px" onclick="window.__wbDeleteUser(' + u.telegramUserId + ')" title="Permanently delete user and data">🗑 Delete</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  window.__wbChangeUserTier = async function(telegramUserId, newTier) {
    try {
      const res = await fetch('/api/access/users/' + telegramUserId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: newTier })
      });
      const data = await res.json();
      if (data.success) {
        window.toast?.('User tier updated to ' + newTier.toUpperCase());
        loadUserAccess();
      } else {
        window.toast?.(data.error || 'Failed updating tier', true);
      }
    } catch (e) {
      window.toast?.(e.message, true);
    }
  };

  window.__wbChangeUserModelOverride = async function(telegramUserId, modelOverride) {
    try {
      const res = await fetch('/api/access/users/' + telegramUserId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customModelOverride: modelOverride })
      });
      const data = await res.json();
      if (data.success) {
        window.toast?.(modelOverride ? 'Assigned model: ' + modelOverride : 'Model override removed (Dynamic routing)');
        loadUserAccess();
      } else {
        window.toast?.(data.error || 'Failed updating model override', true);
      }
    } catch (e) {
      window.toast?.(e.message, true);
    }
  };

  window.__wbResetUserQuota = async function(telegramUserId) {
    if (!confirm("Reset today's usage counter for this user?")) return;
    try {
      const res = await fetch('/api/access/users/' + telegramUserId + '/reset-quota', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        window.toast?.("User quota usage reset to 0 for today");
        loadUserAccess();
      } else {
        window.toast?.(data.error || 'Failed resetting quota', true);
      }
    } catch (e) {
      window.toast?.(e.message, true);
    }
  };

  window.__wbToggleUserStatus = async function(telegramUserId) {
    const userObj = (accessData.users || []).find(x => x.telegramUserId === telegramUserId);
    const nextStatus = userObj && userObj.status === 'suspended' ? 'active' : 'suspended';
    try {
      const res = await fetch('/api/access/users/' + telegramUserId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json();
      if (data.success) {
        window.toast?.('User status changed to ' + nextStatus);
        loadUserAccess();
      } else {
        window.toast?.(data.error || 'Failed updating user status', true);
      }
    } catch (e) {
      window.toast?.(e.message, true);
    }
  };

  window.__wbDeleteUser = async function(telegramUserId) {
    if (!confirm('Are you sure you want to permanently delete user ID ' + telegramUserId + ' and all their conversations, tasks, memories and reminders?')) return;
    try {
      const res = await fetch('/api/access/users/' + telegramUserId, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        window.toast?.('User and all associated data deleted');
        loadUserAccess();
      } else {
        window.toast?.(data.error || 'Failed deleting user', true);
      }
    } catch (e) {
      window.toast?.(e.message, true);
    }
  };

  window.__wbCleanupMockUsers = async function() {
    if (!confirm('Clean up and delete all test mock users (888111000, 1000001, 1000002) from the database?')) return;
    try {
      const res = await fetch('/api/access/cleanup-mock-users', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        window.toast?.(data.message || 'Mock users deleted');
        loadUserAccess();
      } else {
        window.toast?.(data.error || 'Failed cleaning up mock users', true);
      }
    } catch (e) {
      window.toast?.(e.message, true);
    }
  };

  window.__wbSaveAccessPolicy = async function() {
    const defTier = document.getElementById('uaPolicyDefaultTier')?.value || 'free';
    const whitelist = document.getElementById('uaPolicyWhitelist')?.value === 'true';
    const freeQuota = Number(document.getElementById('uaPolicyFreeQuota')?.value) || 30;
    const proQuota = Number(document.getElementById('uaPolicyProQuota')?.value) || 150;
    const freeContext = Number(document.getElementById('uaFreeContextLimit')?.value) || 10;
    const proContext = Number(document.getElementById('uaProContextLimit')?.value) || 30;
    const vipContext = Number(document.getElementById('uaVipContextLimit')?.value) || 60;
    const proStars = Number(document.getElementById('uaProStars')?.value) || 500;
    const vipStars = Number(document.getElementById('uaVipStars')?.value) || 1250;
    const supportContact = document.getElementById('uaSupportContact')?.value || '@admin';
    const proPrice = document.getElementById('uaProPrice')?.value || '$9.99 / month';
    const proCheckout = document.getElementById('uaProCheckout')?.value || '';
    const proCrypto = document.getElementById('uaProCrypto')?.value || '';
    const vipPrice = document.getElementById('uaVipPrice')?.value || '$24.99 / month';
    const vipCheckout = document.getElementById('uaVipCheckout')?.value || '';
    const vipCrypto = document.getElementById('uaVipCrypto')?.value || '';

    try {
      const res = await fetch('/api/access/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultTier: defTier,
          whitelistOnly: whitelist,
          supportContact: supportContact,
          tiers: {
            free: { dailyQuota: freeQuota, contextHistoryLimit: freeContext },
            pro: { dailyQuota: proQuota, contextHistoryLimit: proContext, starsAmount: proStars, priceLabel: proPrice, checkoutUrl: proCheckout, cryptoCheckoutUrl: proCrypto },
            vip: { contextHistoryLimit: vipContext, starsAmount: vipStars, priceLabel: vipPrice, checkoutUrl: vipCheckout, cryptoCheckoutUrl: vipCrypto }
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        window.toast?.('Access Policy and Quotas saved');
        loadUserAccess();
      } else {
        window.toast?.(data.error || 'Failed saving policy', true);
      }
    } catch (e) {
      window.toast?.(e.message, true);
    }
  };

  window.__wbTestRouting = async function() {
    const testTier = document.getElementById('uaTestTier')?.value || 'free';
    const testOverride = document.getElementById('uaTestOverride')?.value || '';
    const testReasoning = document.getElementById('uaTestReasoning')?.value === 'true';
    const resultBox = document.getElementById('uaTestResult');
    if (!resultBox) return;

    resultBox.innerHTML = '<span style="color:var(--muted)">Evaluating adaptive routing algorithm…</span>';
    try {
      const res = await fetch('/api/access/test-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userTier: testTier,
          customModelOverride: testOverride || undefined,
          isDeepReasoning: testReasoning
        })
      });
      const d = await res.json();
      if (d.success) {
        resultBox.innerHTML =
          '<div style="background:#091524;border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:8px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<div><span style="color:var(--muted);font-size:11px">SELECTED MODEL</span><div style="font-size:16px;font-weight:800;color:var(--green)">' + d.selectedProvider + ' / ' + d.selectedModel + '</div></div>' +
              '<div><span class="pill good">Score: ' + d.score + '</span></div>' +
            '</div>' +
            '<div style="margin-top:8px;font-size:12px;color:var(--muted)"><strong>Match reasons:</strong> ' + (d.reasons.join(', ') || 'standard health & latency') + '</div>' +
          '</div>';
      } else {
        resultBox.innerHTML = '<div style="color:var(--red);margin-top:8px">' + (d.error || 'Routing failed') + '</div>';
      }
    } catch (e) {
      resultBox.innerHTML = '<div style="color:var(--red);margin-top:8px">' + e.message + '</div>';
    }
  };

  window.__wbFilterUsers = function() {
    renderUserTable(accessData.users || []);
  };

  function initUserAccessSection(){
    installNav();
    if(!document.getElementById('view-user-access')){
      const section=document.createElement('section');
      section.className='view';
      section.id='view-user-access';
      section.innerHTML = \`
        <div class="grid">
          <div class="card">
            <div class="label">Total Tracked Users</div>
            <div class="value" id="uaStatTotal">—</div>
            <div class="sub">Telegram bot community</div>
          </div>
          <div class="card">
            <div class="label">VIP Members</div>
            <div class="value" id="uaStatVip" style="color:var(--amber)">—</div>
            <div class="sub">Unlimited frontier routing</div>
          </div>
          <div class="card">
            <div class="label">Pro Members</div>
            <div class="value" id="uaStatPro" style="color:var(--blue)">—</div>
            <div class="sub">Elevated limits & speeds</div>
          </div>
          <div class="card">
            <div class="label">Requests Today</div>
            <div class="value" id="uaStatToday">—</div>
            <div class="sub">Smart daily quota usage</div>
          </div>
        </div>

        <div class="split" style="margin-bottom:16px">
          <!-- Global Policy Card -->
          <div class="card section">
            <div class="section-head">
              <div>
                <div class="section-title">Smart Quotas & Tier Policy</div>
                <div class="section-note">Global default quotas and access rules.</div>
              </div>
              <button class="btn primary" onclick="window.__wbSaveAccessPolicy()">Save Policy</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <div>
                <div class="label">Default Tier (New Users)</div>
                <select id="uaPolicyDefaultTier" class="select" style="margin-top:4px">
                  <option value="free">🌱 Free Tier</option>
                  <option value="pro">⚡ Pro Tier</option>
                  <option value="vip">👑 VIP Tier</option>
                </select>
              </div>
              <div>
                <div class="label">Access Mode</div>
                <select id="uaPolicyWhitelist" class="select" style="margin-top:4px">
                  <option value="false">Open to All Telegram Users</option>
                  <option value="true">🔒 Whitelist Only (VIPs/Approved)</option>
                </select>
              </div>
              <div>
                <div class="label">Free Daily Quota</div>
                <input id="uaPolicyFreeQuota" class="input" type="number" value="30" style="margin-top:4px" />
              </div>
              <div>
                <div class="label">Pro Daily Quota</div>
                <input id="uaPolicyProQuota" class="input" type="number" value="150" style="margin-top:4px" />
              </div>
              <div>
                <div class="label">Free Context Retention (Messages)</div>
                <input id="uaFreeContextLimit" class="input" type="number" value="10" style="margin-top:4px" />
              </div>
              <div>
                <div class="label">Pro Context Retention (Messages)</div>
                <input id="uaProContextLimit" class="input" type="number" value="30" style="margin-top:4px" />
              </div>
              <div>
                <div class="label">VIP Context Retention (Messages)</div>
                <input id="uaVipContextLimit" class="input" type="number" value="60" style="margin-top:4px" />
              </div>
            </div>
            
            <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px;">
              <div class="section-title" style="margin-bottom:8px;">💎 Upgrade & Monetization</div>
              <div class="field" style="margin-bottom:12px;">
                <label class="label">Admin Support Telegram Handle</label>
                <input id="uaSupportContact" class="input" placeholder="@admin or @YourSupportHandle" style="margin-top:4px;" />
                <div class="sub">Used on upgrade offer cards in Telegram when users tap locked personas.</div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="field">
                  <label class="label">PRO Plan Price Label</label>
                  <input id="uaProPrice" class="input" placeholder="e.g. $9.99 / mo or 50 Stars" style="margin-top:4px;" />
                  <label class="label" style="margin-top:8px">PRO Telegram Stars (⭐️)</label>
                  <input id="uaProStars" class="input" type="number" value="500" style="margin-top:4px;" />
                  <label class="label" style="margin-top:8px">PRO Card Checkout URL (Stripe)</label>
                  <input id="uaProCheckout" class="input" placeholder="https://buy.stripe.com/..." style="margin-top:4px;" />
                  <label class="label" style="margin-top:8px">PRO Crypto Checkout URL</label>
                  <input id="uaProCrypto" class="input" placeholder="https://commerce.coinbase.com/..." style="margin-top:4px;" />
                </div>
                <div class="field">
                  <label class="label">VIP Plan Price Label</label>
                  <input id="uaVipPrice" class="input" placeholder="e.g. $24.99 / mo or 150 Stars" style="margin-top:4px;" />
                  <label class="label" style="margin-top:8px">VIP Telegram Stars (⭐️)</label>
                  <input id="uaVipStars" class="input" type="number" value="1250" style="margin-top:4px;" />
                  <label class="label" style="margin-top:8px">VIP Card Checkout URL (Stripe)</label>
                  <input id="uaVipCheckout" class="input" placeholder="https://buy.stripe.com/..." style="margin-top:4px;" />
                  <label class="label" style="margin-top:8px">VIP Crypto Checkout URL</label>
                  <input id="uaVipCrypto" class="input" placeholder="https://commerce.coinbase.com/..." style="margin-top:4px;" />
                </div>
              </div>
            </div>

            <div style="font-size:12px;color:var(--muted);background:#091524;padding:8px 12px;border-radius:8px;margin-top:12px;">
              💡 <strong>How Routing Works:</strong> Free users route to ultra-fast, budget-optimized models (e.g. Qwen, Ministral 3B, Gemini Flash). VIP users automatically route to heavy-duty reasoning models (e.g. DeepSeek-R1, GPT-OSS 120B) with unlimited quotas.
            </div>
          </div>

          <!-- Dynamic Routing Simulator -->
          <div class="card section">
            <div class="section-head">
              <div>
                <div class="section-title">🧪 Dynamic Tier Routing Simulator</div>
                <div class="section-note">Live test which model a tier or user will receive.</div>
              </div>
              <button class="btn" onclick="window.__wbTestRouting()">Simulate Route</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
              <div>
                <div class="label">Simulated Tier</div>
                <select id="uaTestTier" class="select" style="margin-top:4px">
                  <option value="free">🌱 Free Tier</option>
                  <option value="pro">⚡ Pro Tier</option>
                  <option value="vip">👑 VIP Tier</option>
                </select>
              </div>
              <div>
                <div class="label">Model Override</div>
                <input id="uaTestOverride" class="input" placeholder="Optional (e.g. deepseek-r1)" style="margin-top:4px" />
              </div>
              <div>
                <div class="label">Deep Reasoning</div>
                <select id="uaTestReasoning" class="select" style="margin-top:4px">
                  <option value="false">Standard chat</option>
                  <option value="true">Thinking / /think</option>
                </select>
              </div>
            </div>
            <div id="uaTestResult">
              <div style="font-size:12px;color:var(--muted);padding:8px 0">Click "Simulate Route" to see live router decision and candidates.</div>
            </div>
          </div>
        </div>

        <!-- User Directory & Management Table -->
        <div class="card section">
          <div class="section-head">
            <div>
              <div class="section-title">Tracked Telegram Users & VIP Tiers</div>
              <div class="section-note">Assign tiers, custom quotas, or specific model overrides to each user.</div>
            </div>
            <div style="display:flex;gap:8px">
              <input id="uaSearchInput" class="input" placeholder="Search user, ID, tier..." style="width:200px" oninput="window.__wbFilterUsers()" />
              <button class="btn" onclick="window.__wbLoadUserAccess()">Refresh</button>
              <button class="btn danger" onclick="window.__wbCleanupMockUsers()" title="Delete mock test users from database">🧹 Clean Up Mock Users</button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Telegram User</th>
                  <th>Tier</th>
                  <th>Today's Quota</th>
                  <th>Model Override</th>
                  <th>Status</th>
                  <th>Activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="wbUserAccessList">
                <tr><td colspan="7" class="empty">Loading tracked users…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      \`;
      document.querySelector('main')?.appendChild(section);
    }
  }

  window.__wbLoadUserAccess = loadUserAccess;
  initUserAccessSection();
})();
</script>`;
}
