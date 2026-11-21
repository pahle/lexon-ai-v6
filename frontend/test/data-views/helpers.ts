import { act } from 'react';
import { settle } from '../render';

export async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
  await settle();
}

export async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function key(el: Element, name: string) {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true }),
    );
  });
  await settle();
}

export const q = (root: ParentNode, selector: string) =>
  root.querySelector(selector);
export const byLabel = (root: ParentNode, label: string) =>
  root.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
export const byText = (root: ParentNode, tag: string, text: string) =>
  Array.from(root.querySelectorAll(tag)).find(
    (n) => n.textContent?.trim() === text,
  ) as HTMLElement | undefined;

const nameOf = (el: Element) => {
  const labelledBy = el.getAttribute('aria-labelledby');
  const byId = labelledBy
    ? labelledBy
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    : '';
  return (
    el.getAttribute('aria-label') ||
    byId ||
    el.textContent ||
    el.getAttribute('title') ||
    ''
  ).trim();
};

/**
 * Accessibility rules that jsdom can check: accessible
 * names on buttons, links, checkboxes, inputs and menu items; column scope;
 * unique ids; valid roles. This stands in for axe-core, which is a dependency
 * of the root @axe-core/playwright only and cannot be imported from the
 * frontend package (module boundary); real axe, dark mode and
 * contrast are covered in Task 19.
 */
export function a11yViolations() {
  {
    const out: string[] = [];
    const named =
      'button, a[href], [role="checkbox"], [role="menuitem"], [role="menuitemcheckbox"], [role="tab"], input:not([type="hidden"])';
    for (const el of document.body.querySelectorAll(named))
      if (!el.closest('[aria-hidden="true"]') && !nameOf(el))
        out.push(`no accessible name: ${el.outerHTML.slice(0, 120)}`);
    for (const th of document.body.querySelectorAll('th'))
      if (!nameOf(th) || th.getAttribute('scope') !== 'col')
        out.push(`header without name or scope: ${th.outerHTML.slice(0, 120)}`);
    const ids = Array.from(document.body.querySelectorAll('[id]')).map(
      (n) => n.id,
    );
    for (const id of new Set(ids.filter((v, k) => ids.indexOf(v) !== k)))
      out.push(`duplicate id ${id}`);
    for (const el of document.body.querySelectorAll('img:not([alt])'))
      out.push(`img without alt: ${el.outerHTML.slice(0, 80)}`);
    for (const el of document.body.querySelectorAll('[role="tab"]'))
      if (!el.closest('[role="tablist"]')) out.push('tab outside tablist');
    return out;
  }
}
