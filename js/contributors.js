'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('contributors-status');
  const listEl = document.getElementById('contributors-list');
  if (!statusEl || !listEl) return;

  try {
    const samples = await loadSamples();
    const contributors = _collectContributors(samples);

    if (!contributors.length) {
      statusEl.textContent = 'No public contributors yet.';
      return;
    }

    statusEl.textContent = `${contributors.length} contributor${contributors.length === 1 ? '' : 's'}`;
    contributors.forEach(({ name, institution }) => {
      const li = document.createElement('li');
      li.className = 'list-group-item px-0';
      li.innerHTML = `<strong>${_esc(name)}</strong><div class="text-muted small">${_esc(institution || 'Institution not provided')}</div>`;
      listEl.appendChild(li);
    });
  } catch {
    statusEl.textContent = 'Could not load contributors.';
  }
});

function _collectContributors(samples) {
  const seen = new Set();
  const out = [];

  (samples || []).forEach(sample => {
    if (!_asBool(sample?.allow_public_acknowledgement)) return;
    const name = String(sample?.collector || '').trim();
    if (!name) return;
    const institution = String(sample?.institution || '').trim();
    const key = `${name.toLowerCase()}|${institution.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, institution });
  });

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function _asBool(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
