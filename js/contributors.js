'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('contributors-status');
  const listEl = document.getElementById('contributors-list');
  if (!statusEl || !listEl) return;

  try {
    const samples = await loadSamples();
    const { contributors, skipped } = _collectContributors(samples);

    if (!contributors.length) {
      statusEl.textContent = 'No public contributors yet.';
      return;
    }

    statusEl.textContent = `${contributors.length} contributor${contributors.length === 1 ? '' : 's'}${skipped ? ` (${skipped} record${skipped === 1 ? '' : 's'} skipped: missing contributor ID)` : ''}`;
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
  let skipped = 0;

  (samples || []).forEach(sample => {
    if (!_asBool(sample?.allow_public_acknowledgement)) return;
    const name = String(sample?.collector || '').trim();
    const institution = String(sample?.institution || '').trim();
    const contributorId = String(sample?.contributor_id || '').trim().toLowerCase()
      || contributorIdFromEmail(sample?.contributor_email);
    if (!name || !contributorId) { skipped += 1; return; }
    if (!outByKey.has(contributorId)) {
      outByKey.set(contributorId, { name, institution, sampleCount: 0 });
    }
    const item = outByKey.get(contributorId);
    item.sampleCount += 1;
    if (!item.institution && institution) item.institution = institution;
    if (item.name !== name && name) item.name = name;
  });

  const contributors = Array.from(outByKey.values()).sort((a, b) => {
    if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
    return a.name.localeCompare(b.name);
  });
  return { contributors, skipped };
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
