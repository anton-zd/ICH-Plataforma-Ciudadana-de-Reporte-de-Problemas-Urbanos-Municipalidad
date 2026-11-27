'use strict';

(() => {
  const storageKey = 'serenazgo-accessibility-preferences';
  const fontLevels = [
    { level: 1, percent: 90, name: 'Compacto' },
    { level: 2, percent: 100, name: 'Normal' },
    { level: 3, percent: 115, name: 'Mediano' },
    { level: 4, percent: 130, name: 'Grande' },
    { level: 5, percent: 145, name: 'Extra grande' }
  ];
  const defaults = { fontLevel: 2, highContrast: false, voiceGuide: false };
  const voiceSupported = 'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function';
  let preferences = { ...defaults };
  let readingHighlight = null;

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    preferences = {
      fontLevel: Number.isInteger(saved.fontLevel) && saved.fontLevel >= 1 && saved.fontLevel <= 5
        ? saved.fontLevel
        : (saved.fontSize === 'extra-large' ? 4 : saved.fontSize === 'large' ? 3 : 2),
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
    const selected = fontLevels.find(item => item.level === preferences.fontLevel) || fontLevels[1];
    root.dataset.accessibilityFontLevel = String(selected.level);
    root.dataset.accessibilityFontSize = selected.level === 2 ? 'normal' : selected.level === 3 ? 'large' : 'extra-large';
    root.style.setProperty('--accessibility-font-scale', String(selected.percent / 100));
    root.style.fontSize = `${selected.percent}%`;
    root.classList.toggle('high-contrast', preferences.highContrast);
    document.querySelectorAll('#accessibility-font-range').forEach(range => {
      range.value = String(selected.level);
      range.style.setProperty('--range-progress', `${((selected.level - 1) / 4) * 100}%`);
      range.setAttribute('aria-valuetext', `${selected.name} ${selected.percent}%`);
    });
    document.querySelectorAll('#accessibility-font-label').forEach(label => {
      label.textContent = `Tamaño de texto: ${selected.name} (${selected.percent}%)`;
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
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(contenido);
    utterance.lang = 'es-PE';
    utterance.rate = 0.95;
    const voces = window.speechSynthesis.getVoices();
    const voz = voces.find(v => v.lang?.toLowerCase().startsWith('es-pe')) ||
      voces.find(v => v.lang?.toLowerCase().includes('es-419')) ||
      voces.find(v => v.lang?.toLowerCase().startsWith('es-mx')) ||
      voces.find(v => v.lang?.toLowerCase().startsWith('es-es')) ||
      voces.find(v => v.lang?.toLowerCase().startsWith('es'));
    if (voz) utterance.voice = voz;
    window.speechSynthesis.speak(utterance);
  }

  function extraerTextoRelevante(target) {
    if (!target || target === document.body || target === document.documentElement) return '';
    const aria = target.getAttribute?.('aria-label');
    if (aria) return aria.trim();
    if (target.labels?.length) return target.labels[0].textContent.replace(/\s+/g, ' ').trim();
    if (target.matches('input, select, textarea')) {
      return target.value || target.placeholder || target.name || '';
    }
    return (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function leerElemento(target) {
    if (!target || target.closest('.accessibility-widget')) return;
    const texto = extraerTextoRelevante(target);
    if (!texto) return;
    if (readingHighlight) readingHighlight.classList.remove('tts-reading-highlight');
    readingHighlight = target;
    target.classList.add('tts-reading-highlight');
    globalThis.clearTimeout(target.__ttsHighlightTimer);
    target.__ttsHighlightTimer = globalThis.setTimeout(() => {
      target.classList.remove('tts-reading-highlight');
      if (readingHighlight === target) readingHighlight = null;
    }, 1400);
    hablar(texto);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderPreferences();
    document.querySelectorAll('#accessibility-font-range').forEach(range => {
      range.addEventListener('input', () => {
        preferences.fontLevel = Math.max(1, Math.min(5, Number(range.value)));
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
        if (key === 'voiceGuide' && preferences.voiceGuide && voiceSupported) {
          hablar('Lectura por voz activada. Toca o selecciona cualquier texto o botón para escucharlo.');
        } else if (key === 'voiceGuide' && voiceSupported) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance('Lectura por voz desactivada.');
          utterance.lang = 'es-PE';
          utterance.rate = 0.95;
          window.speechSynthesis.speak(utterance);
        }
      });
    });

    const probarAccesibilidad = document.getElementById('btn-probar-accesibilidad');
    probarAccesibilidad?.addEventListener('click', event => {
      event.stopPropagation();
      preferences.fontLevel = 4;
      preferences.highContrast = true;
      preferences.voiceGuide = voiceSupported;
      renderPreferences();
      persistPreferences();

      const widget = document.querySelector('.accessibility-widget');
      if (widget instanceof HTMLDetailsElement) widget.open = true;
      probarAccesibilidad.textContent = voiceSupported
        ? 'Modo Accesible Activado'
        : 'Modo Accesible Activado · Voz no disponible';
      probarAccesibilidad.setAttribute('aria-pressed', 'true');
      probarAccesibilidad.classList.remove('btn-warning', 'text-dark');
      probarAccesibilidad.classList.add('btn-success', 'text-white');
      hablar(voiceSupported
        ? 'Modo accesible activado. Texto ampliado, alto contraste y lectura por voz listos para usar'
        : 'Modo accesible activado. Texto ampliado y alto contraste listos para usar. La lectura por voz no está disponible en este navegador');
    });

    document.addEventListener('click', event => {
      const selector = 'button,a,h1,h2,h3,h4,h5,h6,p,label,span,li,td,th,input,select,textarea,[role="button"],.incident-card,.tipo-card,.card-modern';
      const target = event.target.closest(selector);
      leerElemento(target);
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

    document.addEventListener('mouseup', () => {
      const seleccion = window.getSelection()?.toString().replace(/\s+/g, ' ').trim();
      if (seleccion) hablar(seleccion);
    });
    document.addEventListener('touchend', () => {
      const seleccion = window.getSelection()?.toString().replace(/\s+/g, ' ').trim();
      if (seleccion) hablar(seleccion);
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
