// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserGestureGuard } from '../../src/input/BrowserGestureGuard';

describe('mobile native gesture boundary', () => {
  let root: HTMLDivElement;
  let guard: BrowserGestureGuard;
  const dispatch = (target: Element, type: string, cancelable = true) => {
    const event = new Event(type, { bubbles: true, cancelable });
    target.dispatchEvent(event);
    return event;
  };
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = '<canvas class="game-canvas"></canvas><button><span>开始</span></button><section class="result-card"><p>对局说明</p></section><input><textarea></textarea><select><option>一</option></select><div contenteditable="true"><span>输入文字</span></div>';
    document.body.append(root);
    guard = new BrowserGestureGuard(root);
  });
  afterEach(() => { guard.dispose(); root.remove(); });
  it('blocks selection, dragging, menus and double clicks on game labels and controls', () => {
    for (const selector of ['canvas', 'button span', '.result-card p']) {
      for (const type of ['contextmenu', 'selectstart', 'dragstart', 'dblclick']) {
        expect(dispatch(root.querySelector(selector)!, type).defaultPrevented).toBe(true);
      }
    }
  });
  it('cancels only canvas touch defaults and still delivers pointer input', () => {
    const canvas = root.querySelector('canvas')!;
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      const observed = vi.fn(); canvas.addEventListener(type, observed, { once: true });
      expect(dispatch(canvas, type).defaultPrevented).toBe(true);
      expect(observed).toHaveBeenCalledTimes(1);
    }
    const pointer = vi.fn(); canvas.addEventListener('pointerup', pointer);
    expect(dispatch(canvas, 'pointerup').defaultPrevented).toBe(false);
    expect(pointer).toHaveBeenCalledTimes(1);
  });
  it('preserves button activation and dialog scrolling defaults', () => {
    const button = root.querySelector('button')!;
    const click = vi.fn(); button.addEventListener('click', click);
    expect(dispatch(button, 'click').defaultPrevented).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
    for (const target of [button.firstElementChild!, root.querySelector('.result-card p')!]) {
      for (const type of ['touchstart', 'touchmove', 'touchend']) expect(dispatch(target, type).defaultPrevented).toBe(false);
    }
  });
  it('keeps editable controls and contenteditable descendants usable', () => {
    for (const selector of ['input', 'textarea', 'select', 'option', '[contenteditable] span']) {
      for (const type of ['selectstart', 'contextmenu', 'dragstart', 'dblclick', 'touchstart']) {
        expect(dispatch(root.querySelector(selector)!, type).defaultPrevented).toBe(false);
      }
    }
    const child = document.createElement('span'); child.contentEditable = 'false';
    root.querySelector('[contenteditable]')!.append(child);
    expect(dispatch(child, 'selectstart').defaultPrevented).toBe(true);
  });
  it('never affects other page content and removes all handlers on dispose', () => {
    const outside = document.createElement('p'); document.body.append(outside);
    try { expect(dispatch(outside, 'contextmenu').defaultPrevented).toBe(false); }
    finally { outside.remove(); }
    guard.dispose();
    for (const type of ['contextmenu', 'selectstart', 'dragstart', 'dblclick', 'touchstart', 'touchmove', 'touchend']) {
      expect(dispatch(root.querySelector('canvas')!, type).defaultPrevented).toBe(false);
    }
  });
});
