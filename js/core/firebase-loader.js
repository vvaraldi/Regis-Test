/**
 * Firebase Loader with Retry Mechanism
 * Loads Firebase scripts with automatic retry on failure
 */

// Flag to track Firebase initialization status
window.firebaseReady = false;

function loadScript(src, retries = 3) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => {
      if (retries > 0) {
        console.warn(`Retrying ${src}...`);
        setTimeout(() => loadScript(src, retries - 1).then(resolve).catch(reject), 1000);
      } else {
        reject(new Error(`Failed to load ${src}`));
      }
    };
    document.head.appendChild(script);
  });
}

async function loadFirebase() {
  try {
    await loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-storage-compat.js');
    
    // Initialize Firebase (function defined in auth.js)
    if (typeof initFirebase === 'function') {
      initFirebase();
    }
    
    // Mark Firebase as ready and dispatch event
    window.firebaseReady = true;
    window.dispatchEvent(new Event('firebaseReady'));
    
  } catch (error) {
    console.error('Failed to load Firebase:', error);
    // Show user-friendly error message
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = '<div style="text-align:center;padding:2rem;"><p style="color:#ef4444;font-weight:600;">Erreur de connexion</p><p style="margin-top:0.5rem;">Impossible de charger l\'application. Veuillez rafraîchir la page.</p><button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;">Rafraîchir</button></div>';
    }
  }
}

/**
 * Helper function to run code when Firebase is ready
 * Usage: onFirebaseReady(() => { ... });
 */
function onFirebaseReady(callback) {
  if (window.firebaseReady) {
    callback();
  } else {
    window.addEventListener('firebaseReady', callback, { once: true });
  }
}

loadFirebase();
