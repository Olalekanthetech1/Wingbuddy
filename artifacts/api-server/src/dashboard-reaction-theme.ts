export function renderDashboardReactionTheme(): string {
  return String.raw`
<style>
.wb-reaction-section {
  margin-top: 18px;
  margin-bottom: 18px;
}
.wb-reaction-header {
  margin-bottom: 14px;
}
.wb-reaction-title {
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text, #f0f6fc);
}
.wb-reaction-desc {
  font-size: 12.5px;
  color: var(--muted, #8b949e);
  margin-top: 4px;
  line-height: 1.4;
}
.wb-reaction-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wb-reaction-card {
  position: relative;
  background: #080f1e;
  border: 1px solid #162a45;
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}
.wb-reaction-card:hover {
  border-color: #2b5280;
  background: #0b1528;
}
.wb-reaction-card.active {
  border-color: #3b82f6;
  background: #0c1830;
  box-shadow: 0 0 0 1px #3b82f6, 0 4px 20px rgba(59, 130, 246, 0.15);
}
.wb-reaction-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.wb-reaction-card-title {
  font-size: 14.5px;
  font-weight: 600;
  color: #f0f6fc;
}
.wb-reaction-radio {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #304460;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.wb-reaction-card.active .wb-reaction-radio {
  border-color: #3b82f6;
  background: #3b82f6;
}
.wb-reaction-card.active .wb-reaction-radio::after {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffffff;
}
.wb-reaction-card-desc {
  font-size: 12.5px;
  color: #8b949e;
  margin-bottom: 10px;
}
.wb-reaction-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.wb-reaction-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3.5px 9px;
  border-radius: 6px;
  background: #040812;
  border: 1px solid #142236;
  font-size: 11.5px;
  font-weight: 500;
  color: #c9d1d9;
}
.wb-reaction-pill.typing-only {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #6e7681;
}
.wb-reaction-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #162a45;
  flex-wrap: wrap;
  gap: 10px;
}
.wb-reaction-status {
  font-size: 12px;
  color: #8b949e;
}
</style>

<script>
(function() {
  function esc(v) {
    return String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function toast(msg, bad) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.borderColor = bad ? 'rgba(255,102,117,.4)' : '#2a4665';
    clearTimeout(window.__wbToastTimer);
    window.__wbToastTimer = setTimeout(function() { el.style.display = 'none'; }, 4000);
  }

  var currentTheme = 'modern_snappy';
  var availableThemes = [];

  async function loadReactionThemes() {
    try {
      var res = await fetch('/api/reaction-theme');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      currentTheme = data.currentThemeId || 'modern_snappy';
      availableThemes = data.themes || [];
      renderReactionCards();
    } catch (err) {
      var grid = document.getElementById('wbReactionGrid');
      if (grid) {
        grid.innerHTML = '<div class="empty">Unable to load reaction theme config: ' + esc(err.message) + '</div>';
      }
    }
  }

  function renderReactionCards() {
    var grid = document.getElementById('wbReactionGrid');
    if (!grid) return;

    if (!availableThemes.length) {
      grid.innerHTML = '<div class="empty">No themes available.</div>';
      return;
    }

    grid.innerHTML = availableThemes.map(function(t) {
      var isActive = t.id === currentTheme;
      var pillsHtml = t.pills.map(function(p) {
        if (!p.emoji) {
          return '<span class="wb-reaction-pill typing-only">' + esc(p.label) + '</span>';
        }
        return '<span class="wb-reaction-pill">' + esc(p.emoji) + ' ' + esc(p.label) + '</span>';
      }).join('');

      return '<div class="wb-reaction-card ' + (isActive ? 'active' : '') + '" data-theme-id="' + esc(t.id) + '">' +
        '<div class="wb-reaction-card-top">' +
          '<div class="wb-reaction-card-title">' + esc(t.name) + '</div>' +
          '<div class="wb-reaction-radio"></div>' +
        '</div>' +
        '<div class="wb-reaction-card-desc">' + esc(t.description) + '</div>' +
        '<div class="wb-reaction-pills">' + pillsHtml + '</div>' +
      '</div>';
    }).join('');
  }

  function mountReactionSection() {
    var target = document.getElementById('view-overview');
    if (!target || document.getElementById('wbReactionSection')) return;

    var wrap = document.createElement('div');
    wrap.className = 'card wb-reaction-section';
    wrap.id = 'wbReactionSection';
    wrap.innerHTML = '<div class="wb-reaction-header">' +
      '<div class="wb-reaction-title">' +
        '<span>✨ Contextual Emoji Reactions & Status Feedback</span>' +
      '</div>' +
      '<div class="wb-reaction-desc">' +
        'Instantly reacts to user prompts on Telegram with dynamic emojis and live typing indicator heartbeats.' +
      '</div>' +
    '</div>' +
    '<div class="wb-reaction-grid" id="wbReactionGrid">' +
      '<div style="padding: 16px; text-align: center; color: var(--muted);">Loading reaction preferences…</div>' +
    '</div>' +
    '<div class="wb-reaction-actions">' +
      '<div class="wb-reaction-status" id="wbReactionStatus">' +
        'Zero-fallback Telegram Bot API verified reactions. Persisted in PostgreSQL.' +
      '</div>' +
      '<div style="display: flex; gap: 8px;">' +
        '<button class="btn small" id="wbReactionTestBtn">' +
          '<span>⚡ Test Live Bot Connectivity</span>' +
        '</button>' +
      '</div>' +
    '</div>';

    target.appendChild(wrap);
    loadReactionThemes();
  }

  document.addEventListener('click', async function(e) {
    var card = e.target.closest('#wbReactionGrid .wb-reaction-card');
    if (card) {
      var themeId = card.getAttribute('data-theme-id');
      if (!themeId || themeId === currentTheme) return;

      try {
        var res = await fetch('/api/reaction-theme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ themeId: themeId, adminUser: 'dashboard_admin' })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update theme');

        currentTheme = themeId;
        renderReactionCards();
        toast('✓ Switched reaction theme to ' + data.theme.name, false);
      } catch (err) {
        toast('✕ Error: ' + err.message, true);
      }
      return;
    }

    if (e.target.closest('#wbReactionTestBtn')) {
      var btn = document.getElementById('wbReactionTestBtn');
      btn.disabled = true;
      btn.textContent = 'Testing connectivity…';
      try {
        var res = await fetch('/api/reaction-theme/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emoji: '⚡' })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Test failed');
        toast('✓ ' + (data.message || 'Telegram Bot API verified successfully!'), false);
      } catch (err) {
        toast('✕ Connectivity check: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>⚡ Test Live Bot Connectivity</span>';
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountReactionSection);
  } else {
    mountReactionSection();
  }
})();
</script>
`;
}
