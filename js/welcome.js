'use strict';

document.addEventListener('DOMContentLoaded', () => {
  if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
  _ensureWelcomeModal();
  const modalEl = document.getElementById('welcome-modal');
  if (!modalEl) return;
  const modal = new bootstrap.Modal(modalEl, {
    backdrop: 'static',
    keyboard: false,
  });
  modal.show();
});

function _ensureWelcomeModal() {
  if (document.getElementById('welcome-modal')) return;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal fade" id="welcome-modal" tabindex="-1" aria-labelledby="welcome-modal-title" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="welcome-modal-title">Welcome</h5>
          </div>
          <div class="modal-body">
            <p class="mb-0">
              Welcome to the global river surface grain size database! Please share your Wolman samples from around the world and help us to build a complete community dataset. For questions or to suggest changes to this website (e.g. metadata uploaded with each sample), please contact Anya Leenman at anya.leenman@usherbrooke.ca. Lastly, please cite any data you download if the uploader has included citation information. Thank you!
            </p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(wrapper.firstElementChild);
}
