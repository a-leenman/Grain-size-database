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
    contributors.forEach(({ name, institution, sampleCount }) => {
      const li = document.createElement('li');
      li.className = 'list-group-item px-0';
      li.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <strong>${_esc(name)}</strong>
            <div class="text-muted small">${_esc(institution || 'Institution not provided')}</div>
          </div>
          <span class="badge text-bg-primary rounded-pill">${sampleCount}</span>
        </div>`;
      listEl.appendChild(li);
    });
  } catch {
    statusEl.textContent = 'Could not load contributors.';
  }
});

function _collectContributors(samples) {
  const outByKey = new Map();

  (samples || []).forEach(sample => {
    if (!_asBool(sample?.allow_public_acknowledgement)) return;
    const contributorId = String(sample?.contributor_id || '').trim().toLowerCase();
    const name = String(sample?.collector || '').trim();
    if (!contributorId || !name) return;
    const institution = String(sample?.institution || '').trim();
    if (!outByKey.has(contributorId)) {
      outByKey.set(contributorId, { name, institution, sampleCount: 0 });
    }
    const item = outByKey.get(contributorId);
    item.sampleCount += 1;
    if (!item.institution && institution) item.institution = institution;
    if (item.name !== name && name) item.name = name;
  });

  return Array.from(outByKey.values()).sort((a, b) => {
    if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
    return a.name.localeCompare(b.name);
  });
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
