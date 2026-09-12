export function renderDashboardPersonas(): string {
  return String.raw`<script>
(function(){
  function showPersonasView(){
    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
    document.querySelectorAll('.nav button,.mobile-nav button').forEach(function(b){ b.classList.remove('active'); });
    var view = document.getElementById('view-personas');
    if (view) view.classList.add('active');
    document.querySelectorAll('[data-personas-nav]').forEach(function(b){ b.classList.add('active'); });
    if (window.__wbLoadPersonas) window.__wbLoadPersonas();
  }

  function installNav(){
    ['nav','mobileNav'].forEach(function(id){
      var root = document.getElementById(id);
      if(root && !root.querySelector('[data-personas-nav]')){
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.personasNav = '';
        b.textContent = '🎭 Personas';
        b.addEventListener('click', showPersonasView);
        root.appendChild(b);
      }
    });
  }

  var personasData = { personas: [], stats: {} };
  var availableModels = [];

  async function loadModels() {
    try {
      var res = await fetch('/api/models');
      var data = await res.json();
      availableModels = (data.models || []).filter(function(m){ return m.enabled && !m.roles.includes('embedding'); });
      populateModelDropdowns();
    } catch (_) {}
  }

  function populateModelDropdowns() {
    var sel = document.getElementById('personaFormModel');
    if (!sel) return;
    var currentVal = sel.value;
    var html = '<option value="">🤖 Auto-Adaptive Routing (Best for task)</option>';
    availableModels.forEach(function(m){
      html += '<option value="' + m.id + '">' + (m.displayName || m.modelId) + ' (' + m.provider + ')</option>';
    });
    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
  }

  async function loadPersonas() {
    var container = document.getElementById('wbPersonasList');
    if (!container) return;
    try {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">Loading persona registry…</div>';
      var res = await fetch('/api/personas');
      var json = await res.json();
      if (json.success) {
        personasData = json;
        renderStats(json.stats);
        renderPersonaCards(json.personas, json.stats);
      } else {
        container.innerHTML = '<div style="grid-column:1/-1;color:var(--red);padding:20px">' + (json.error || 'Failed to load personas') + '</div>';
      }
    } catch (e) {
      container.innerHTML = '<div style="grid-column:1/-1;color:var(--red);padding:20px">Error loading personas: ' + e.message + '</div>';
    }
  }

  function renderStats(stats) {
    if (!stats) return;
    var elTotal = document.getElementById('personaStatTotal');
    var elActive = document.getElementById('personaStatActive');
    var elCustom = document.getElementById('personaStatCustom');
    var elBuiltIn = document.getElementById('personaStatBuiltIn');
    if (elTotal) elTotal.textContent = stats.totalPersonas || '0';
    if (elActive) elActive.textContent = stats.enabledPersonas || '0';
    if (elCustom) elCustom.textContent = stats.customPersonas || '0';
    if (elBuiltIn) elBuiltIn.textContent = stats.builtInPersonas || '0';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderPersonaCards(personas, stats) {
    var container = document.getElementById('wbPersonasList');
    if (!container) return;
    if (!personas || personas.length === 0) {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">No personas registered. Click "Create Persona" or "Reset to Defaults".</div>';
      return;
    }

    var userCounts = (stats && stats.personaUserCounts) ? stats.personaUserCounts : {};

    var cardsHtml = personas.map(function(p){
      var usersCount = userCounts[p.id] || 0;
      var tierBadgeClass = p.requiredTier === 'vip' ? 'badge-vip' : (p.requiredTier === 'pro' ? 'badge-pro' : 'badge-free');
      var tierLabel = p.requiredTier === 'vip' ? '👑 VIP' : (p.requiredTier === 'pro' ? '⚡ PRO' : '🌱 FREE');
      var modelLabel = p.preferredModel ? p.preferredModel.split(':').pop().replace(/_/g, '/') : 'Auto-Adaptive';
      var tempDesc = p.temperature <= 0.3 ? 'Analytical (' + p.temperature + ')' : (p.temperature >= 0.8 ? 'Creative (' + p.temperature + ')' : 'Balanced (' + p.temperature + ')');

      return '<div class="card persona-card ' + (p.enabled ? '' : 'disabled-persona') + '" style="position:relative;display:flex;flex-direction:column;justify-content:space-between;border:1px solid ' + (p.enabled ? 'var(--line)' : 'color-mix(in srgb, var(--line) 40%, transparent)') + ';border-radius:12px;padding:16px;background:var(--panel-2);color:var(--text);transition:background-color .18s ease,color .18s ease,border-color .18s ease;">' +
        '<div>' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
            '<div style="display:flex;align-items:center;gap:10px;">' +
              '<span style="font-size:28px;line-height:1;">' + (p.emoji || '🎭') + '</span>' +
              '<div>' +
                '<div style="font-weight:600;font-size:16px;color:var(--text);display:flex;align-items:center;gap:6px;">' +
                  escapeHtml(p.name) +
                  (p.isBuiltIn ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(59,130,246,0.15);color:var(--blue);border:1px solid rgba(59,130,246,0.3)">Built-In</span>' : '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,0.15);color:#c084fc;border:1px solid rgba(168,85,247,0.3)">Custom</span>') +
                '</div>' +
                '<div style="font-size:12px;color:var(--muted);margin-top:2px;">' + escapeHtml(p.tagline || '') + '</div>' +
              '</div>' +
            '</div>' +
            '<span class="badge ' + tierBadgeClass + '" style="font-size:11px;padding:3px 8px;border-radius:6px;font-weight:600;">' + tierLabel + '</span>' +
          '</div>' +

          '<div style="font-size:12px;color:var(--text);background:var(--panel-3);border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:12px;max-height:80px;overflow:hidden;text-overflow:ellipsis;line-height:1.5;font-family:monospace;">' +
            escapeHtml(p.systemPrompt.slice(0, 180)) + (p.systemPrompt.length > 180 ? '…' : '') +
          '</div>' +

          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;color:var(--muted);margin-bottom:14px;">' +
            '<div>🧠 <strong>Engine:</strong> <span style="color:var(--blue)">' + escapeHtml(modelLabel) + '</span></div>' +
            '<div>🌡️ <strong>Temp:</strong> <span style="color:var(--warn, #fbbf24)">' + tempDesc + '</span></div>' +
            '<div>👥 <strong>Active Users:</strong> <span style="color:var(--green);font-weight:600">' + usersCount + '</span></div>' +
            '<div>⚡ <strong>Telegram:</strong> <code>/persona ' + escapeHtml(p.id) + '</code></div>' +
          '</div>' +
        '</div>' +

        '<div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px;margin-top:4px;">' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text);">' +
            '<input type="checkbox" ' + (p.enabled ? 'checked' : '') + ' onchange="window.__wbTogglePersona(\'' + p.id + '\', this.checked)" />' +
            '<span>' + (p.enabled ? 'Active' : 'Disabled') + '</span>' +
          '</label>' +
          '<div style="display:flex;gap:6px;">' +
            '<button class="btn" style="padding:4px 10px;font-size:12px;" onclick="window.__wbEditPersona(\'' + p.id + '\')">Edit</button>' +
            '<button class="btn" style="padding:4px 10px;font-size:12px;" onclick="window.__wbTestPersona(\'' + p.id + '\')">🧪 Test</button>' +
            (!p.isBuiltIn ? '<button class="btn danger" style="padding:4px 8px;font-size:12px;" onclick="window.__wbDeletePersona(\'' + p.id + '\')">🗑️</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = cardsHtml;
  }

  window.__wbTogglePersona = async function(id, enabled) {
    try {
      var res = await fetch('/api/personas/' + encodeURIComponent(id) + '/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled })
      });
      var data = await res.json();
      if (!data.success) {
        alert(data.error || 'Failed to toggle persona');
      }
      loadPersonas();
    } catch (err) {
      alert('Error: ' + err.message);
      loadPersonas();
    }
  };

  window.__wbDeletePersona = async function(id) {
    if (!confirm('Are you sure you want to delete this custom persona? Users currently using it will be moved back to the Default Assistant.')) return;
    try {
      var res = await fetch('/api/personas/' + encodeURIComponent(id), { method: 'DELETE' });
      var data = await res.json();
      if (data.success) {
        loadPersonas();
      } else {
        alert(data.error || 'Failed to delete persona');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  window.__wbResetPersonas = async function() {
    if (!confirm('Reset all personas to factory defaults? Custom personas will be deleted and built-ins restored.')) return;
    try {
      var res = await fetch('/api/personas/reset', { method: 'POST' });
      var data = await res.json();
      if (data.success) {
        alert('Personas reset successfully!');
        loadPersonas();
      } else {
        alert(data.error || 'Failed to reset');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  window.__wbOpenPersonaModal = function(editId) {
    var modal = document.getElementById('personaModal');
    var title = document.getElementById('personaModalTitle');
    var form = document.getElementById('personaForm');
    if (!modal || !form) return;

    populateModelDropdowns();

    if (editId) {
      var persona = (personasData.personas || []).find(function(p){ return p.id === editId; });
      if (!persona) return;
      title.textContent = 'Edit Persona: ' + persona.name;
      document.getElementById('personaFormId').value = persona.id;
      document.getElementById('personaFormName').value = persona.name;
      document.getElementById('personaFormEmoji').value = persona.emoji || '🎭';
      document.getElementById('personaFormTagline').value = persona.tagline || '';
      document.getElementById('personaFormPrompt').value = persona.systemPrompt || '';
      document.getElementById('personaFormModel').value = persona.preferredModel || '';
      document.getElementById('personaFormTemp').value = persona.temperature !== undefined ? persona.temperature : 0.7;
      document.getElementById('personaFormTempVal').textContent = String(persona.temperature !== undefined ? persona.temperature : 0.7);
      document.getElementById('personaFormTier').value = persona.requiredTier || 'free';
      document.getElementById('personaFormOrder').value = persona.sortOrder || 10;
    } else {
      title.textContent = 'Create New Persona';
      form.reset();
      document.getElementById('personaFormId').value = '';
      document.getElementById('personaFormEmoji').value = '🎭';
      document.getElementById('personaFormTemp').value = 0.7;
      document.getElementById('personaFormTempVal').textContent = '0.7';
      document.getElementById('personaFormTier').value = 'free';
      document.getElementById('personaFormOrder').value = (personasData.personas ? personasData.personas.length + 1 : 10);
    }

    modal.style.display = 'flex';
  };

  window.__wbClosePersonaModal = function() {
    var modal = document.getElementById('personaModal');
    if (modal) modal.style.display = 'none';
  };

  window.__wbEditPersona = function(id) {
    window.__wbOpenPersonaModal(id);
  };

  window.__wbSavePersonaForm = async function(e) {
    if (e) e.preventDefault();
    var id = document.getElementById('personaFormId').value.trim();
    var name = document.getElementById('personaFormName').value.trim();
    var emoji = document.getElementById('personaFormEmoji').value.trim() || '🎭';
    var tagline = document.getElementById('personaFormTagline').value.trim();
    var systemPrompt = document.getElementById('personaFormPrompt').value.trim();
    var preferredModel = document.getElementById('personaFormModel').value.trim() || null;
    var temp = parseFloat(document.getElementById('personaFormTemp').value);
    var requiredTier = document.getElementById('personaFormTier').value;
    var sortOrder = parseInt(document.getElementById('personaFormOrder').value, 10) || 10;

    if (!name) { alert('Name is required'); return; }
    if (!systemPrompt) { alert('System Prompt instructions are required'); return; }

    var payload = {
      id: id || undefined,
      name: name,
      emoji: emoji,
      tagline: tagline,
      systemPrompt: systemPrompt,
      preferredModel: preferredModel,
      temperature: isNaN(temp) ? 0.7 : temp,
      requiredTier: requiredTier,
      sortOrder: sortOrder,
      enabled: true
    };

    try {
      var url = id ? ('/api/personas/' + encodeURIComponent(id)) : '/api/personas';
      var method = id ? 'PUT' : 'POST';
      var res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (data.success) {
        window.__wbClosePersonaModal();
        loadPersonas();
      } else {
        alert(data.error || 'Failed to save persona');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // Quick Preset Templates
  var PRESET_TEMPLATES = {
    tutor: {
      name: "Language Tutor",
      emoji: "🎓",
      tagline: "Immersive polyglot language mentor",
      systemPrompt: "You are a master language teacher and polyglot coach. When the user speaks, respond in the target language while providing gentle, inline corrections for grammar and vocabulary in parenthesis. Adapt your language complexity to their skill level and encourage fluid dialogue.",
      preferredModel: "",
      temperature: 0.7,
      requiredTier: "free"
    },
    cbt_coach: {
      name: "Mindfulness & Focus Coach",
      emoji: "🧘",
      tagline: "Empathetic, grounding daily clarity mentor",
      systemPrompt: "You are an empathetic, calm, and insightful mindfulness and cognitive coach. Help the user reframe cognitive distortions, prioritize their day with stoic calm, and celebrate small wins. Never give medical advice; provide soothing, pragmatic guidance.",
      preferredModel: "",
      temperature: 0.6,
      requiredTier: "free"
    },
    quantum: {
      name: "Theoretical Physicist",
      emoji: "🔬",
      tagline: "First-principles derivations and deep mathematics",
      systemPrompt: "You are a world-class theoretical physicist and mathematician. Derive equations from first principles using clean LaTeX notation. Provide rigorous intuition, identify underlying symmetries, and challenge unwarranted assumptions.",
      preferredModel: "huggingface:deepseek-ai_DeepSeek-R1",
      temperature: 0.2,
      requiredTier: "vip"
    },
    yc_advisor: {
      name: "Startup Pitch & Strategy Advisor",
      emoji: "💼",
      tagline: "High-conviction product strategy and pitch scrutiny",
      systemPrompt: "You are a sharp, seasoned Silicon Valley venture partner. Scrutinize product ideas with extreme clarity: unit economics, distribution moats, retention loops, and acute customer pain points. Be direct, constructive, and avoid corporate fluff.",
      preferredModel: "",
      temperature: 0.5,
      requiredTier: "pro"
    }
  };

  window.__wbApplyPreset = function(presetKey) {
    var p = PRESET_TEMPLATES[presetKey];
    if (!p) return;
    document.getElementById('personaFormName').value = p.name;
    document.getElementById('personaFormEmoji').value = p.emoji;
    document.getElementById('personaFormTagline').value = p.tagline;
    document.getElementById('personaFormPrompt').value = p.systemPrompt;
    document.getElementById('personaFormModel').value = p.preferredModel || '';
    document.getElementById('personaFormTemp').value = p.temperature;
    document.getElementById('personaFormTempVal').textContent = String(p.temperature);
    document.getElementById('personaFormTier').value = p.requiredTier;
  };

  // Test Simulator
  window.__wbTestPersona = function(id) {
    var p = (personasData.personas || []).find(function(item){ return item.id === id; });
    if (!p) return;
    document.getElementById('personaSimId').value = p.id;
    document.getElementById('personaSimName').textContent = (p.emoji || '🎭') + ' ' + p.name;
    document.getElementById('personaSimOutput').textContent = 'Ready to test ' + p.name + '. Enter a prompt below and click "Run Simulation".';
    document.getElementById('personaSimModal').style.display = 'flex';
  };

  window.__wbCloseTestModal = function() {
    var m = document.getElementById('personaSimModal');
    if (m) m.style.display = 'none';
  };

  window.__wbRunPersonaSim = async function() {
    var id = document.getElementById('personaSimId').value;
    var prompt = document.getElementById('personaSimPrompt').value.trim();
    var out = document.getElementById('personaSimOutput');
    if (!prompt) { alert('Please enter a test prompt'); return; }

    var p = (personasData.personas || []).find(function(item){ return item.id === id; });
    if (!p) return;

    out.textContent = 'Simulating prompt with persona ' + p.name + '…\\nConnecting to AI router…';

    try {
      var res = await fetch('/api/simulator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          overridePersonality: p.systemPrompt,
          modelOverride: p.preferredModel || undefined,
          temperature: p.temperature
        })
      });
      var data = await res.json();
      if (data.reply) {
        out.innerHTML = '<div style="margin-bottom:8px;font-size:11px;color:#38bdf8;"><strong>Engine Used:</strong> ' + escapeHtml(data.modelUsed || 'Dynamic') + ' | <strong>Persona:</strong> ' + escapeHtml(p.name) + '</div><div style="white-space:pre-wrap;line-height:1.6;">' + escapeHtml(data.reply) + '</div>';
      } else {
        out.textContent = 'Simulator response: ' + JSON.stringify(data, null, 2);
      }
    } catch (err) {
      out.textContent = 'Simulation error: ' + err.message;
    }
  };

  function initPersonasSection() {
    installNav();
    loadModels();

    if (!document.getElementById('view-personas')) {
      var section = document.createElement('section');
      section.id = 'view-personas';
      section.className = 'view';
      section.innerHTML = 
        '<div class="grid col-4" style="margin-bottom:16px;">' +
          '<div class="card stat"><div class="label">Total Personas</div><div class="val" id="personaStatTotal">-</div><div class="sub">System & Custom</div></div>' +
          '<div class="card stat"><div class="label">Active / Enabled</div><div class="val" id="personaStatActive" style="color:var(--green, #10b981)">-</div><div class="sub">Ready in Telegram</div></div>' +
          '<div class="card stat"><div class="label">Built-In Agents</div><div class="val" id="personaStatBuiltIn" style="color:var(--accent, #38bdf8)">-</div><div class="sub">Factory Specialists</div></div>' +
          '<div class="card stat"><div class="label">Custom Created</div><div class="val" id="personaStatCustom" style="color:#c084fc">-</div><div class="sub">User/Admin Defined</div></div>' +
        '</div>' +

        '<div class="card section" style="margin-bottom:20px;">' +
          '<div class="section-head">' +
            '<div>' +
              '<div class="section-title">🎭 Switchable AI Personas & Specialized Agents</div>' +
              '<div class="section-note">Empower Telegram users to switch between specialized personas on-demand (e.g. <code>/persona tutor</code>, <code>/persona architect</code>). Each persona dynamically controls system prompts, model scoring, temperature, and tier access.</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="btn primary" onclick="window.__wbOpenPersonaModal()">➕ Create Persona</button>' +
              '<button class="btn" onclick="window.__wbLoadPersonas()">🔄 Refresh</button>' +
              '<button class="btn danger" onclick="window.__wbResetPersonas()" title="Restore factory built-in personas">Reset Defaults</button>' +
            '</div>' +
          '</div>' +
          '<div id="wbPersonasList" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:16px;margin-top:16px;">' +
            '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">Loading personas…</div>' +
          '</div>' +
        '</div>' +

        '<!-- Modal for Create/Edit Persona -->' +
        '<div id="personaModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px);">' +
          '<div class="card" style="width:100%;max-width:680px;max-height:90vh;overflow-y:auto;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;box-shadow:var(--shadow);">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid var(--line);padding-bottom:12px;">' +
              '<h3 id="personaModalTitle" style="margin:0;font-size:18px;font-weight:600;color:var(--text);">Create Persona</h3>' +
              '<button class="btn" style="padding:4px 8px;font-size:14px;" onclick="window.__wbClosePersonaModal()">✕</button>' +
            '</div>' +

            '<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--text);">' +
              '<strong>💡 Quick Presets:</strong> ' +
              '<button type="button" class="btn" style="padding:2px 8px;font-size:11px;margin-left:6px;" onclick="window.__wbApplyPreset(\'tutor\')">🎓 Language Tutor</button>' +
              '<button type="button" class="btn" style="padding:2px 8px;font-size:11px;margin-left:4px;" onclick="window.__wbApplyPreset(\'cbt_coach\')">🧘 Mind Coach</button>' +
              '<button type="button" class="btn" style="padding:2px 8px;font-size:11px;margin-left:4px;" onclick="window.__wbApplyPreset(\'quantum\')">🔬 Theoretical Physicist</button>' +
              '<button type="button" class="btn" style="padding:2px 8px;font-size:11px;margin-left:4px;" onclick="window.__wbApplyPreset(\'yc_advisor\')">💼 Startup Advisor</button>' +
            '</div>' +

            '<form id="personaForm" onsubmit="window.__wbSavePersonaForm(event)">' +
              '<input type="hidden" id="personaFormId" />' +
              '<div style="display:grid;grid-template-columns:80px 1fr;gap:12px;margin-bottom:12px;">' +
                '<div>' +
                  '<label class="label">Emoji</label>' +
                  '<input id="personaFormEmoji" class="input" style="text-align:center;font-size:20px;" maxlength="4" value="🎭" />' +
                '</div>' +
                '<div>' +
                  '<label class="label">Persona Name *</label>' +
                  '<input id="personaFormName" class="input" placeholder="e.g. Software Architect, Therapist" required />' +
                '</div>' +
              '</div>' +

              '<div style="margin-bottom:12px;">' +
                '<label class="label">Short Tagline</label>' +
                '<input id="personaFormTagline" class="input" placeholder="e.g. Senior distributed systems engineer" />' +
              '</div>' +

              '<div style="margin-bottom:12px;">' +
                '<label class="label">System Prompt Instructions *</label>' +
                '<textarea id="personaFormPrompt" class="input" style="height:140px;font-family:monospace;font-size:12px;line-height:1.5;" placeholder="Define the persona tone, voice, expertise, rules, and response structure..." required></textarea>' +
              '</div>' +

              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">' +
                '<div>' +
                  '<label class="label">Preferred AI Model Engine</label>' +
                  '<select id="personaFormModel" class="select">' +
                    '<option value="">🤖 Auto-Adaptive Routing</option>' +
                  '</select>' +
                  '<div style="font-size:11px;color:var(--muted);margin-top:2px;">Router prioritizes this engine when this persona is active.</div>' +
                '</div>' +
                '<div>' +
                  '<label class="label">Required Access Tier</label>' +
                  '<select id="personaFormTier" class="select">' +
                    '<option value="free">🌱 Free (All Users)</option>' +
                    '<option value="pro">⚡ Pro Pass</option>' +
                    '<option value="vip">👑 VIP Pass Exclusive</option>' +
                  '</select>' +
                  '<div style="font-size:11px;color:var(--muted);margin-top:2px;">Gated personas guide users to upgrade.</div>' +
                '</div>' +
              '</div>' +

              '<div style="display:grid;grid-template-columns:1fr 120px;gap:12px;margin-bottom:16px;">' +
                '<div>' +
                  '<div style="display:flex;justify-content:space-between;">' +
                    '<label class="label">Creativity / Temperature</label>' +
                    '<span id="personaFormTempVal" style="font-size:12px;font-weight:600;color:var(--warn, #fbbf24);">0.7</span>' +
                  '</div>' +
                  '<input type="range" id="personaFormTemp" min="0.1" max="1.0" step="0.05" value="0.7" style="width:100%;margin-top:6px;" oninput="document.getElementById(\'personaFormTempVal\').textContent=this.value" />' +
                  '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);">' +
                    '<span>0.1 (Strict Logic)</span>' +
                    '<span>0.7 (Balanced)</span>' +
                    '<span>1.0 (Creative)</span>' +
                  '</div>' +
                '</div>' +
                '<div>' +
                  '<label class="label">Sort Order</label>' +
                  '<input type="number" id="personaFormOrder" class="input" value="10" />' +
                '</div>' +
              '</div>' +

              '<div style="display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--line);padding-top:16px;">' +
                '<button type="button" class="btn" onclick="window.__wbClosePersonaModal()">Cancel</button>' +
                '<button type="submit" class="btn primary">Save Persona</button>' +
              '</div>' +
            '</form>' +
          '</div>' +
        '</div>' +

        '<!-- Modal for Testing Persona Simulator -->' +
        '<div id="personaSimModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px);">' +
          '<div class="card" style="width:100%;max-width:640px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;box-shadow:var(--shadow);">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid var(--line);padding-bottom:10px;">' +
              '<h3 style="margin:0;font-size:16px;font-weight:600;color:var(--text);">🧪 Live Persona Simulation: <span id="personaSimName" style="color:var(--blue);"></span></h3>' +
              '<button class="btn" style="padding:4px 8px;font-size:14px;" onclick="window.__wbCloseTestModal()">✕</button>' +
            '</div>' +
            '<input type="hidden" id="personaSimId" />' +
            '<div id="personaSimOutput" style="background:var(--panel-3);border:1px solid var(--line);border-radius:8px;padding:12px;min-height:120px;max-height:240px;overflow-y:auto;font-size:13px;color:var(--text);margin-bottom:14px;">' +
              'Ready to simulate.' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
              '<input id="personaSimPrompt" class="input" placeholder="Type a message to test this persona..." style="flex:1;" onkeydown="if(event.key===\'Enter\'){window.__wbRunPersonaSim();}" />' +
              '<button class="btn primary" onclick="window.__wbRunPersonaSim()">Simulate</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.querySelector('main')?.appendChild(section);
    }
  }

  window.__wbLoadPersonas = loadPersonas;
  initPersonasSection();
})();
</script>`;
}
