'use strict';

(() => {
  const storageKey = 'serenazgo-accessibility-preferences';
  const fontSizes = ['normal', 'large', 'extra-large'];
  const defaults = { fontSize: 'normal', highContrast: false, voiceGuide: false };
  const voiceSupported = 'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function';
  let preferences = { ...defaults };
  let lastSpokenText = '';
  let lastSpokenAt = 0;

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    preferences = {
      fontSize: fontSizes.includes(saved.fontSize) ? saved.fontSize : defaults.fontSize,
      highContrast: saved.highContrast === true,
      voiceGuide: saved.voiceGuide === true && voiceSupported
    };
  } catch (error) {
    console.warn('No se pudieron leer las preferencias de accesibilidad guardadas:', error);
  }

  function persistPreferences() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch (error) {
      console.warn('No se pudieron guardar las preferencias de accesibilidad:', error);
    }
  }

  function renderPreferences() {
    const root = document.documentElement;
    root.dataset.accessibilityFontSize = preferences.fontSize;
    root.classList.toggle('high-contrast', preferences.highContrast);
    document.querySelectorAll('[data-font-size]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.fontSize === preferences.fontSize));
    });
    document.querySelectorAll('[data-accessibility-toggle]').forEach(button => {
      const key = button.dataset.accessibilityToggle;
      button.setAttribute('aria-pressed', String(preferences[key]));
    });
    document.dispatchEvent(new CustomEvent('accessibilitypreferenceschange', {
      detail: { ...preferences }
    }));
  }

  function hablar(texto) {
    const contenido = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    if (!preferences.voiceGuide || !contenido || !voiceSupported) return;
    const ahora = Date.now();
    if (contenido === lastSpokenText && ahora - lastSpokenAt < 800) return;
    lastSpokenText = contenido;
    lastSpokenAt = ahora;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(contenido);
    utterance.lang = 'es-PE';
    window.speechSynthesis.speak(utterance);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderPreferences();
    document.querySelectorAll('[data-font-size]').forEach(button => {
      button.addEventListener('click', () => {
        preferences.fontSize = button.dataset.fontSize;
        renderPreferences();
        persistPreferences();
      });
    });
    document.querySelectorAll('[data-accessibility-toggle]').forEach(button => {
      const key = button.dataset.accessibilityToggle;
      button.disabled = key === 'voiceGuide' && !voiceSupported;
      button.addEventListener('click', () => {
        preferences[key] = !preferences[key];
        renderPreferences();
        persistPreferences();
        if (key === 'voiceGuide' && !preferences.voiceGuide && voiceSupported) {
          window.speechSynthesis.cancel();
        }
      });
    });

    document.addEventListener('click', event => {
      const target = event.target.closest('button, a, [role="button"], h1, h2, h3, h4, h5, h6');
      if (target && !target.closest('.accessibility-widget')) {
        hablar(target.getAttribute('aria-label') || target.textContent);
      }
    });
    document.addEventListener('focusin', event => {
      const target = event.target.closest('button, a, [role="button"], input, select, textarea');
      if (target && !target.closest('.accessibility-widget')) {
        const label = target.getAttribute('aria-label') ||
          (target.labels && target.labels.length ? target.labels[0].textContent : '') ||
          target.textContent || target.getAttribute('placeholder') || target.value;
        hablar(label);
      }
    });

    const observer = new MutationObserver(records => {
      records.forEach(record => {
        const element = record.target.nodeType === Node.ELEMENT_NODE
          ? record.target
          : record.target.parentElement;
        const alert = element?.closest('[role="alert"], [role="status"], [aria-live], .toast');
        if (alert) hablar(alert.textContent);
        record.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const alertNode = node.matches('[role="alert"], [role="status"], [aria-live], .toast')
            ? node
            : node.querySelector('[role="alert"], [role="status"], [aria-live], .toast');
          if (alertNode) hablar(alertNode.textContent);
        });
      });
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  });
})();
