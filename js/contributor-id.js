'use strict';

function contributorIdFromEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return '';
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) + value.charCodeAt(i);
    hash &= 0xffffffff;
  }
  return `contrib-${(hash >>> 0).toString(16)}`;
}
