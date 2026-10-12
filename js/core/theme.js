/**
 * theme.js - Theme Management for the portal
 * ============================================
 * Handles light/dark theme switching with Firebase sync
 */

class ThemeManager {
  constructor() {
    this.currentTheme = 'light';
    this.init();
  }

  /**
   * Initialize theme from localStorage (fast) then sync with Firebase
   */
  init() {
    // 1. First, apply theme from localStorage for instant load
    const savedTheme = localStorage.getItem('orford-theme');
    if (savedTheme) {
      this.applyTheme(savedTheme, false);
    } else {
      // Check system preference
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        this.applyTheme('dark', false);
      }
    }

    // 2. Listen for system theme changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only auto-switch if user hasn't set a preference
        if (!localStorage.getItem('orford-theme')) {
          this.applyTheme(e.matches ? 'dark' : 'light', false);
        }
      });
    }
  }

  /**
   * Sync theme with Firebase user preferences
   * Called after user authentication
   */
  async syncWithFirebase(userData) {
    if (userData?.preferences?.theme) {
      this.applyTheme(userData.preferences.theme, false);
    }
  }

  /**
   * Apply theme to document
   * @param {string} theme - 'light' or 'dark'
   * @param {boolean} saveToFirebase - Whether to save to Firebase
   */
  applyTheme(theme, saveToFirebase = true) {
    this.currentTheme = theme;
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('orford-theme', theme);

    // Update toggle button icons if they exist
    this.updateToggleIcons();

    // Dispatch event for other components
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));

    // Save to Firebase if requested and user is authenticated
    if (saveToFirebase && window.currentUser && window.db) {
      this.saveToFirebase(theme);
    }
  }

  /**
   * Toggle between light and dark themes
   */
  toggle() {
    const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme(newTheme, true);
  }

  /**
   * Set a specific theme
   * @param {string} theme - 'light' or 'dark'
   */
  setTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      this.applyTheme(theme, true);
    }
  }

  /**
   * Get current theme
   * @returns {string} Current theme name
   */
  getTheme() {
    return this.currentTheme;
  }

  /**
   * Check if dark mode is active
   * @returns {boolean}
   */
  isDark() {
    return this.currentTheme === 'dark';
  }

  /**
   * Update toggle button icons based on current theme
   */
  updateToggleIcons() {
    const toggleButtons = document.querySelectorAll('.theme-toggle, [data-theme-toggle]');
    toggleButtons.forEach(btn => {
      const sunIcon = btn.querySelector('.icon-sun, .theme-toggle__icon--sun');
      const moonIcon = btn.querySelector('.icon-moon, .theme-toggle__icon--moon');
      
      if (sunIcon && moonIcon) {
        if (this.currentTheme === 'dark') {
          sunIcon.style.display = 'block';
          moonIcon.style.display = 'none';
        } else {
          sunIcon.style.display = 'none';
          moonIcon.style.display = 'block';
        }
      }
    });

    // Update theme selector if on profile page
    const themeOptions = document.querySelectorAll('.theme-option');
    themeOptions.forEach(option => {
      const optionTheme = option.dataset.theme;
      if (optionTheme === this.currentTheme) {
        option.classList.add('is-selected');
      } else {
        option.classList.remove('is-selected');
      }
    });

    // Update mobile nav toggle switch if it exists
    const mobileToggle = document.querySelector('.mobile-nav__theme-toggle');
    if (mobileToggle) {
      mobileToggle.checked = this.currentTheme === 'dark';
    }
  }

  /**
   * Save theme preference to Firebase
   * @param {string} theme - Theme to save
   */
  async saveToFirebase(theme) {
    try {
      if (window.currentUser && window.db) {
        await window.db.collection('inspectors').doc(window.currentUser.uid).update({
          'preferences.theme': theme
        });
        console.log('Theme preference saved to Firebase:', theme);
      }
    } catch (error) {
      console.warn('Could not save theme to Firebase:', error);
      // Non-critical error, theme is still saved locally
    }
  }

  /**
   * Create theme toggle button HTML
   * @param {string} type - 'icon' for icon-only, 'switch' for toggle switch
   * @returns {string} HTML string
   */
  static createToggleHTML(type = 'icon') {
    if (type === 'switch') {
      return `
        <label class="form-switch">
          <input type="checkbox" class="form-switch__input mobile-nav__theme-toggle" 
                 onchange="window.themeManager.toggle()">
          <span class="form-switch__label">Mode sombre</span>
        </label>
      `;
    }
    
    return `
      <button class="theme-toggle" onclick="window.themeManager.toggle()" 
              aria-label="Changer le thème" title="Changer le thème">
        <svg class="theme-toggle__icon theme-toggle__icon--moon icon-moon" 
             width="20" height="20" viewBox="0 0 24 24" fill="none" 
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
        <svg class="theme-toggle__icon theme-toggle__icon--sun icon-sun" 
             width="20" height="20" viewBox="0 0 24 24" fill="none" 
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" 
             style="display: none;">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      </button>
    `;
  }
}

// Initialize theme manager globally
window.themeManager = new ThemeManager();

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
}
