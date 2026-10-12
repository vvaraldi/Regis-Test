/**
 * ui.js - UI Components for the portal
 * ======================================
 * Mobile menu, modals, and other UI interactions
 */

/**
 * Mobile Menu Manager
 */
class MobileMenu {
  constructor() {
    this.nav = document.getElementById('mobile-nav');
    this.backdrop = document.getElementById('mobile-nav-backdrop');
    this.openBtn = document.getElementById('mobile-menu-btn');
    this.closeBtn = document.getElementById('mobile-nav-close');
    
    this.init();
  }

  init() {
    if (this.openBtn) {
      this.openBtn.addEventListener('click', () => this.open());
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.backdrop) {
      this.backdrop.addEventListener('click', () => this.close());
    }

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });

    // Close when clicking a nav link
    if (this.nav) {
      this.nav.querySelectorAll('.mobile-nav__link').forEach(link => {
        link.addEventListener('click', () => this.close());
      });
    }
  }

  open() {
    if (this.nav) this.nav.classList.add('is-active');
    if (this.backdrop) this.backdrop.classList.add('is-active');
    document.body.style.overflow = 'hidden';
  }

  close() {
    if (this.nav) this.nav.classList.remove('is-active');
    if (this.backdrop) this.backdrop.classList.remove('is-active');
    document.body.style.overflow = '';
  }

  isOpen() {
    return this.nav && this.nav.classList.contains('is-active');
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }
}

/**
 * Modal Manager
 * Unified modal system for the entire application
 */
class Modal {
  constructor(options = {}) {
    this.id = options.id || `modal-${Date.now()}`;
    this.title = options.title || '';
    this.content = options.content || '';
    this.size = options.size || ''; // sm, lg, xl, full
    this.type = options.type || ''; // confirm, image, form, drawer
    this.closable = options.closable !== false;
    this.onClose = options.onClose || null;
    this.onConfirm = options.onConfirm || null;
    this.confirmText = options.confirmText || 'Confirmer';
    this.cancelText = options.cancelText || 'Annuler';
    this.confirmClass = options.confirmClass || 'btn-primary';
    
    this.element = null;
    this.create();
  }

  create() {
    // Create modal element
    this.element = document.createElement('div');
    this.element.id = this.id;
    this.element.className = `modal ${this.size ? `modal--${this.size}` : ''} ${this.type ? `modal--${this.type}` : ''}`;
    
    this.element.innerHTML = `
      <div class="modal__container">
        ${this.title ? `
          <div class="modal__header">
            <h3 class="modal__title">${this.title}</h3>
            ${this.closable ? '<button class="modal__close" aria-label="Fermer">✕</button>' : ''}
          </div>
        ` : ''}
        <div class="modal__body">
          ${this.content}
        </div>
        ${this.type === 'confirm' ? `
          <div class="modal__footer">
            <button class="btn btn-secondary modal__cancel">${this.cancelText}</button>
            <button class="btn ${this.confirmClass} modal__confirm">${this.confirmText}</button>
          </div>
        ` : ''}
      </div>
    `;

    // Add event listeners
    if (this.closable) {
      const closeBtn = this.element.querySelector('.modal__close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.close());
      }

      // Close on backdrop click
      this.element.addEventListener('click', (e) => {
        if (e.target === this.element) {
          this.close();
        }
      });
    }

    // Confirm button
    const confirmBtn = this.element.querySelector('.modal__confirm');
    if (confirmBtn && this.onConfirm) {
      confirmBtn.addEventListener('click', () => {
        this.onConfirm();
        this.close();
      });
    }

    // Cancel button
    const cancelBtn = this.element.querySelector('.modal__cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.close());
    }

    // Add to document
    document.body.appendChild(this.element);
  }

  open() {
    if (this.element) {
      this.element.classList.add('is-active');
      document.body.classList.add('modal-open');
      
      // Focus first input if form modal
      const firstInput = this.element.querySelector('input, select, textarea');
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
      }
    }
    return this;
  }

  close() {
    if (this.element && !this._closing) {
      this._closing = true;
      this.element.classList.remove('is-active');
      document.body.classList.remove('modal-open');
      
      if (this.onClose) {
        this.onClose();
      }
      this._closing = false;
    }
    return this;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    
    if (this.element) {
      this.element.classList.remove('is-active');
      document.body.classList.remove('modal-open');
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }

  setContent(content) {
    const body = this.element.querySelector('.modal__body');
    if (body) {
      body.innerHTML = content;
    }
    return this;
  }

  setTitle(title) {
    const titleEl = this.element.querySelector('.modal__title');
    if (titleEl) {
      titleEl.textContent = title;
    }
    return this;
  }

  setLoading(loading) {
    if (loading) {
      this.element.classList.add('modal--loading');
      this.setContent(`
        <div class="modal__spinner"></div>
        <p class="modal__loading-text">Chargement...</p>
      `);
    } else {
      this.element.classList.remove('modal--loading');
    }
    return this;
  }
}

/**
 * Create and show a confirmation modal
 *
 * NOT called confirm(): a global function named confirm / alert replaces the browser's own
 * window.confirm / window.alert for every script of the page. Those return a Promise here, and a
 * Promise is always truthy, so `if (!confirm('Sure?')) return;` never stopped anything: the action
 * ran while the dialog was still on screen (and alert('text') showed "undefined"). The pages call
 * the native, synchronous versions; use these (with await) only for a styled dialog.
 * @param {Object} options - Modal options
 * @returns {Promise<boolean>} User's choice
 */
function confirmDialog(options) {
  return new Promise((resolve) => {
    let resolved = false;
    const modal = new Modal({
      title: options.title || 'Confirmation',
      content: `
        ${options.icon ? `<div class="modal__icon modal__icon--${options.iconType || 'warning'}">${options.icon}</div>` : ''}
        <p class="modal__message">${options.message || 'Êtes-vous sûr?'}</p>
        ${options.description ? `<p class="modal__description">${options.description}</p>` : ''}
      `,
      type: 'confirm',
      confirmText: options.confirmText || 'Confirmer',
      cancelText: options.cancelText || 'Annuler',
      confirmClass: options.confirmClass || 'btn-primary',
      onConfirm: () => {
        if (!resolved) {
          resolved = true;
          resolve(true);
          modal.destroy();
        }
      },
      onClose: () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
          modal.destroy();
        }
      }
    });

    modal.open();
  });
}

/**
 * User Menu Dropdown
 */
class UserMenu {
  constructor() {
    this.container = document.querySelector('.user-menu');
    this.trigger = document.querySelector('.user-menu__trigger');
    this.dropdown = document.querySelector('.user-menu__dropdown');
    
    this.init();
  }

  init() {
    if (!this.trigger || !this.container) return;

    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.close();
      }
    });

    // Close on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  }

  open() {
    this.container.classList.add('is-open');
  }

  close() {
    this.container.classList.remove('is-open');
  }

  isOpen() {
    return this.container.classList.contains('is-open');
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }
}

/**
 * Initialize all UI components
 */
function initUI() {
  // Initialize mobile menu
  window.mobileMenu = new MobileMenu();
  
  // Initialize user menu
  window.userMenu = new UserMenu();
  
  // Initialize any existing modals with data-modal attribute
  document.querySelectorAll('[data-modal-trigger]').forEach(trigger => {
    const modalId = trigger.dataset.modalTrigger;
    const modal = document.getElementById(modalId);
    
    if (modal) {
      trigger.addEventListener('click', () => {
        modal.classList.add('is-active');
        document.body.classList.add('modal-open');
      });

      const closeBtn = modal.querySelector('.modal__close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          modal.classList.remove('is-active');
          document.body.classList.remove('modal-open');
        });
      }

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('is-active');
          document.body.classList.remove('modal-open');
        }
      });
    }
  });

  // Close modals on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.is-active').forEach(modal => {
        modal.classList.remove('is-active');
      });
      document.body.classList.remove('modal-open');
    }
  });
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initUI);

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MobileMenu,
    Modal,
    UserMenu,
    confirmDialog,
    initUI
  };
}
