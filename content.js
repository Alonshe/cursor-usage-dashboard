/**
 * Cursor Spend Dashboard — Content Script
 *
 * Watches for the green "CSV export download started!" banner on cursor.com/dashboard
 * and injects a "View Spend Dashboard" button.
 */

(function () {
  'use strict';

  const DASH_URL = chrome.runtime.getURL('dashboard.html');
  const MARKER_ATTR = 'data-csd-injected';

  function extractCsvUrl(container) {
    // Try input fields first (the URL box)
    const inputs = container.querySelectorAll('input');
    for (const inp of inputs) {
      if (inp.value && inp.value.includes('export-usage-events-csv')) return inp.value;
    }
    // Try anchor tags
    const links = container.querySelectorAll('a[href]');
    for (const a of links) {
      if (a.href.includes('export-usage-events-csv')) return a.href;
    }
    // Try raw text
    const match = (container.textContent || '').match(
      /(https:\/\/cursor\.com\/api\/dashboard\/export-usage-events-csv[^\s'"<>]+)/
    );
    return match ? match[1] : null;
  }

  function createButton(csvUrl) {
    const wrap = document.createElement('div');
    wrap.setAttribute(MARKER_ATTR, 'true');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;';

    const btn = document.createElement('button');
    btn.style.cssText =
      'display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border:none;border-radius:8px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:600;' +
      'cursor:pointer;background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;' +
      'box-shadow:0 2px 8px rgba(108,92,231,0.3);transition:all .2s;';
    btn.textContent = '📊 View Spend Dashboard';
    btn.onmouseenter = () => { btn.style.filter = 'brightness(1.12)'; btn.style.transform = 'translateY(-1px)'; };
    btn.onmouseleave = () => { btn.style.filter = ''; btn.style.transform = ''; };

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = '⏳ Loading…';

      try {
        let csvText = null;
        if (csvUrl) {
          try {
            const res = await fetch(csvUrl, { credentials: 'include' });
            if (res.ok) {
              const text = await res.text();
              if (text.includes(',') && !text.includes('<!DOCTYPE')) csvText = text;
            }
          } catch (e) { console.warn('[CSD] fetch failed:', e); }
        }

        await chrome.storage.local.set({
          cursorCsvData: csvText,
          cursorCsvUrl: csvUrl || null,
          cursorCsvTimestamp: Date.now()
        });

        window.open(DASH_URL, '_blank');
      } catch (err) {
        console.error('[CSD] Error:', err);
        window.open(DASH_URL, '_blank');
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });

    wrap.appendChild(btn);
    return wrap;
  }

  function tryInject() {
    // Already injected?
    if (document.querySelector(`[${MARKER_ATTR}]`)) return;

    // Strategy: find any element whose text contains the CSV banner phrase
    // We search all elements but filter for the most specific match
    const allEls = document.querySelectorAll('*');
    let bannerEl = null;

    for (const el of allEls) {
      // Check direct text content (not children) — look for the heading text
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE &&
            child.textContent.includes('CSV export download started')) {
          bannerEl = el;
          break;
        }
      }
      if (bannerEl) break;
    }

    if (!bannerEl) return;

    // Walk up to find a reasonable container (the green box)
    // Climb up parents until we find one that likely wraps the entire banner
    let container = bannerEl;
    for (let i = 0; i < 6; i++) {
      if (!container.parentElement) break;
      const parent = container.parentElement;
      // Stop if parent seems like a page-level layout (too many children or huge)
      if (parent.children.length > 8) break;
      // Check if this parent contains the URL input — that means we're at the right level
      if (parent.querySelector('input') && parent.textContent.includes('Dismiss')) {
        container = parent;
        break;
      }
      container = parent;
    }

    const csvUrl = extractCsvUrl(container);
    const button = createButton(csvUrl);

    // Insert: find the "Dismiss" text and put our button near it
    const dismiss = findDismiss(container);
    if (dismiss) {
      dismiss.parentElement.insertBefore(button, dismiss.nextSibling);
    } else {
      container.appendChild(button);
    }

    console.log('[CSD] Dashboard button injected', csvUrl ? '(URL found)' : '(no URL)');
  }

  function findDismiss(container) {
    // Find the "Dismiss" link/button
    const els = container.querySelectorAll('a, button, span, div');
    for (const el of els) {
      if (el.childNodes.length <= 2) {
        const text = (el.textContent || '').trim();
        if (text === 'Dismiss') return el;
      }
    }
    return null;
  }

  // ── Run ──
  // Initial check
  tryInject();

  // Watch for SPA DOM changes
  const observer = new MutationObserver(() => tryInject());
  observer.observe(document.body, { childList: true, subtree: true });
})();
