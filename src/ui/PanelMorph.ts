import { h, svg } from './dom';
import { ICONS } from './icons';

/**
 * Panel minimize (M13): the panel card is also the show-panel key.
 *
 * Hide: the contents fade out (FADE ms), then the card shrinks from the panel size to the
 * 48 px floating key, anchored at its top left (--edge, --edge), while its radius, border and
 * shadow turn into the key's and the key face fades in. The sidebar icon stays on screen
 * throughout and glides the few px from the header button to the centre of the key.
 * Show: the card grows back (MORPH ms), the contents fade in over its tail (CONTENTS_IN to TOTAL).
 *
 * The card animates width / height (not a scale), so corners, border and shadow stay crisp.
 * The contents keep their open size while morphing and minimised (the card clips them), so the
 * scroll position survives. A toggle mid-way reverses the running animations from where they
 * are. prefers-reduced-motion: instant.
 */

/** Contents fade, card morph and their overlap, ms. Total = FADE + MORPH - OVERLAP. */
const FADE = 150;
const MORPH = 280;
const OVERLAP = 30;
const TOTAL = FADE + MORPH - OVERLAP;
/** Show: contents fade in from here to TOTAL, ms. */
const CONTENTS_IN = 180;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const FADE_OUT = 'cubic-bezier(0.4, 0, 1, 1)';

export interface PanelMorph {
  /** The show-panel key (the minimised card). */
  key: HTMLButtonElement;
  /** Open or minimise. `instant` skips the animation (first paint). */
  set(open: boolean, instant?: boolean): void;
  /** The open card's width (for the transport, also while minimised or morphing). */
  openWidth(): number;
  /** True while the card animates. */
  running(): boolean;
  dispose(): void;
}

interface OpenBox { w: number; h: number; sw: number; sh: number; ix: number; iy: number }

/**
 * @param card    the panel (.panel)
 * @param scroller the scrolling contents (.panel-scroll)
 * @param headIcon the header hide button's icon, where the key icon starts
 * @param onKey   the key was activated (shows the panel; mid-morph it reverses the morph)
 */
export function createPanelMorph(card: HTMLElement, scroller: HTMLElement, headIcon: Element, onKey: () => void): PanelMorph {
  const icon = h('span', { class: 'panel-key-icon' }, svg(ICONS.sidebar));
  const led = h('span', { class: 'led', 'aria-hidden': 'true' });
  const key = h('button', {
    type: 'button', class: 'panel-key', 'aria-label': 'Show panel', 'aria-controls': card.id,
    'aria-expanded': 'false', 'data-tip': 'Show panel (H)', onclick: () => onKey(),
  }, led, icon);
  const face = h('div', { class: 'panel-face', 'aria-hidden': 'true' });
  card.append(face, key);
  // The 1 px border around the key's hit area.
  const onCardClick = (e: MouseEvent) => { if (e.target === card && (!open || anims.length)) onKey(); };
  card.addEventListener('click', onCardClick);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let open = true;
  let anims: Animation[] = [];
  let lastW = card.offsetWidth || parseFloat(getComputedStyle(card).width) || 340;

  /** Open layout of the card, measured without the minimised / morphing classes (the caller
   *  sets the next state). The scroll position is kept. */
  const measure = (): OpenBox => {
    const top = scroller.scrollTop;
    card.classList.remove('is-min', 'is-morphing');
    scroller.style.width = '';
    scroller.style.height = '';
    const c = card.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const i = headIcon.getBoundingClientRect();
    const box: OpenBox = {
      w: card.offsetWidth, h: card.offsetHeight, sw: scroller.clientWidth, sh: scroller.clientHeight,
      // Icon position in the card's padding box, as if the contents were not scrolled.
      ix: i.left - c.left - card.clientLeft, iy: i.top - s.top + scroller.scrollTop,
    };
    scroller.scrollTop = top;
    lastW = box.w;
    return box;
  };

  /** Contents inert and hidden from assistive tech while (becoming) minimised. */
  const syncAccess = () => {
    scroller.toggleAttribute('inert', !open);
    scroller.setAttribute('aria-hidden', String(!open));
    key.setAttribute('aria-expanded', String(open));
    // Live while minimised and while morphing (a click mid-way reverses).
    key.toggleAttribute('inert', open && !anims.length);
    card.classList.toggle('is-on', open);
  };

  const pinContents = (b: OpenBox) => {
    scroller.style.width = `${b.sw}px`;
    scroller.style.height = `${b.sh}px`;
    card.style.setProperty('--icon-x', `${b.ix}px`);
    card.style.setProperty('--icon-y', `${b.iy}px`);
  };

  /** Final state, with transitions off so nothing eases from the animated values. */
  const commit = () => {
    card.style.transition = 'none';
    card.classList.remove('is-morphing');
    card.classList.toggle('is-min', !open);
    if (open) { scroller.style.width = ''; scroller.style.height = ''; }
    for (const a of anims) a.cancel();
    anims = [];
    syncAccess();
    void card.offsetWidth;
    requestAnimationFrame(() => { card.style.transition = ''; });
  };

  const tokens = () => {
    const cs = getComputedStyle(card);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      panel: { borderRadius: v('--card-r'), borderColor: v('--panel-border'), boxShadow: v('--panel-shadow') },
      key: { borderRadius: v('--float-key-r'), borderColor: v('--float-key-border'), boxShadow: v('--float-key-shadow') },
      k: parseFloat(v('--float-key')) || 48,
    };
  };

  const run = (b: OpenBox, scrolled: boolean) => {
    const t = tokens();
    const kc = (t.k - 2 * card.clientLeft - 16) / 2;
    const big = { width: `${b.w}px`, height: `${b.h}px`, ...t.panel };
    const small = { width: `${t.k}px`, height: `${t.k}px`, ...t.key };
    const iconOpen = `translate(${b.ix}px, ${b.iy}px)`;
    const iconKey = `translate(${kc}px, ${kc}px)`;
    const opts: KeyframeAnimationOptions = { duration: TOTAL, fill: 'both' };
    const fadeEnd = FADE / TOTAL;
    const morphStart = (FADE - OVERLAP) / TOTAL;
    const morphEnd = MORPH / TOTAL;
    // Show: the eased grow looks complete well before its end, so the contents start fading in
    // at CONTENTS_IN ms (card at ~90% of its size) and finish with the timeline.
    const contentsIn = CONTENTS_IN / TOTAL;
    // An icon not at its header spot (contents scrolled) cross-fades instead of popping.
    const iconOp = scrolled ? 0 : 1;
    if (!open) {
      anims = [
        card.animate([{ ...big, offset: 0 }, { ...big, offset: morphStart, easing: EASE }, { ...small, offset: 1 }], opts),
        scroller.animate([{ opacity: 1, easing: FADE_OUT }, { opacity: 0, offset: fadeEnd }, { opacity: 0 }], opts),
        face.animate([{ opacity: 0 }, { opacity: 0, offset: morphStart, easing: EASE }, { opacity: 1, offset: 0.85 }, { opacity: 1 }], opts),
        led.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], opts),
        icon.animate([
          { transform: iconOpen, opacity: iconOp }, { transform: iconOpen, opacity: 1, offset: morphStart, easing: EASE },
          { transform: iconKey, opacity: 1 }], opts),
      ];
    } else {
      anims = [
        card.animate([{ ...small, offset: 0, easing: EASE }, { ...big, offset: morphEnd }, { ...big, offset: 1 }], opts),
        scroller.animate([{ opacity: 0 }, { opacity: 0, offset: contentsIn, easing: EASE }, { opacity: 1 }], opts),
        face.animate([{ opacity: 1, easing: EASE }, { opacity: 0, offset: 0.55 }, { opacity: 0 }], opts),
        led.animate([{ opacity: 1 }, { opacity: 0, offset: 0.3 }, { opacity: 0 }], opts),
        icon.animate([
          { transform: iconKey, opacity: 1, easing: EASE }, { transform: iconOpen, opacity: 1, offset: morphEnd },
          { transform: iconOpen, opacity: iconOp }], opts),
      ];
    }
    const mine = anims;
    anims[0].onfinish = () => { if (anims === mine) commit(); };
  };

  const set = (next: boolean, instant = false) => {
    if (next === open && !instant) return;
    open = next;
    syncAccess();
    // Interrupted: run the same animations backwards from where they are.
    if (anims.length) {
      for (const a of anims) a.reverse();
      return;
    }
    const b = measure();
    pinContents(b);
    if (instant || reduce.matches) {
      commit();
      return;
    }
    card.classList.add('is-morphing');
    run(b, scroller.scrollTop > 1);
    syncAccess();
  };

  syncAccess();
  return {
    key,
    set,
    openWidth: () => lastW,
    running: () => anims.length > 0,
    dispose: () => {
      for (const a of anims) a.cancel();
      card.removeEventListener('click', onCardClick);
      key.remove();
      face.remove();
    },
  };
}
