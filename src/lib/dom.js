/*
 | DOM helpers that behave the same inside and outside Shadow DOM.
 |
 | `document.activeElement` stops at a shadow boundary: from the document's
 | point of view, focus inside a shadow root is "on the host element". Code
 | that compares it to an inner element therefore never matches, and a focus
 | trap written that way silently stops trapping the moment the component is
 | embedded — which is exactly the context where a keyboard user is least able
 | to recover. The embed's isolation is worth nothing if it costs them Tab.
 */

/**
 * The element that actually has focus, following shadow roots down.
 *
 * @param {Document|ShadowRoot} [root]
 * @returns {Element|null}
 */
export function activeElementDeep(root = typeof document !== 'undefined' ? document : null) {
    if (!root) return null;
    let el = root.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el ?? null;
}

/**
 * Focus trap step for a Tab keypress inside `container`. Returns true when it
 * handled the key (and called preventDefault), so the caller can return early.
 */
export function trapTab(event, container) {
    if (event.key !== 'Tab' || !container) return false;

    const focusables = container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return false;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = activeElementDeep(container.getRootNode?.() ?? document);

    if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return true;
    }
    if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
        return true;
    }
    return false;
}
