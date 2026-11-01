import { h } from '../dom';

/**
 * One OLED tooltip (design 84:11965) for every element with data-tip, shown on hover
 * (after a short delay) and on keyboard focus, placed under the element, kept on screen.
 * The text is also set as aria-description, so screen readers get it without the bubble.
 */
export function installTooltips(root: HTMLElement = document.body): () => void {
  const tip = h('div', { class: 'tooltip', role: 'tooltip', hidden: true });
  document.body.append(tip);
  let timer = 0;
  let current: HTMLElement | null = null;

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text) return;
    current = el;
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const x = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
    const below = r.bottom + 8 + t.height < window.innerHeight;
    tip.style.left = `${x}px`;
    tip.style.top = `${below ? r.bottom + 8 : r.top - 8 - t.height}px`;
  };
  const hide = () => {
    clearTimeout(timer);
    current = null;
    tip.hidden = true;
  };
  const target = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;

  const over = (e: PointerEvent) => {
    const el = target(e);
    if (el === current) return;
    hide();
    if (el) timer = window.setTimeout(() => show(el), 450);
  };
  const focus = (e: FocusEvent) => {
    const el = target(e);
    if (el && el.matches(':focus-visible')) show(el);
  };
  root.addEventListener('pointerover', over);
  root.addEventListener('pointerleave', hide);
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('focusin', focus);
  root.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true);

  // Keep aria-description in sync for elements that carry a tip.
  const describe = () => root.querySelectorAll<HTMLElement>('[data-tip]').forEach((el) => el.setAttribute('aria-description', el.dataset.tip!));
  const mo = new MutationObserver(describe);
  mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tip'] });
  describe();

  return () => {
    mo.disconnect();
    root.removeEventListener('pointerover', over);
    root.removeEventListener('pointerleave', hide);
    root.removeEventListener('pointerdown', hide, true);
    root.removeEventListener('focusin', focus);
    root.removeEventListener('focusout', hide);
    window.removeEventListener('scroll', hide, true);
    tip.remove();
  };
}
