import { domPath, elementAtPath } from './scrollRestoration';

function tree() {
  const root = document.createElement('div');
  root.innerHTML = '<div><span></span><span id="t"></span></div><p></p>';
  return root;
}

describe('scrollRestoration path helpers', () => {
  it('round-trips a nested element', () => {
    const root = tree();
    const target = root.querySelector('#t')!;
    const path = domPath(target, root)!;
    expect(path).toBe('0.1');
    expect(elementAtPath(root, path)).toBe(target);
  });

  it('represents the root itself as empty string', () => {
    const root = tree();
    expect(domPath(root, root)).toBe('');
    expect(elementAtPath(root, '')).toBe(root);
  });

  it('disambiguates siblings', () => {
    const root = tree();
    const first = root.querySelector('span')!;
    const second = root.querySelector('#t')!;
    expect(domPath(first, root)).toBe('0.0');
    expect(domPath(second, root)).toBe('0.1');
    expect(elementAtPath(root, '0.0')).toBe(first);
  });

  it('returns null when element is outside root', () => {
    const root = tree();
    const stray = document.createElement('div');
    expect(domPath(stray, root)).toBeNull();
  });

  it('returns null for a path that no longer resolves', () => {
    const root = tree();
    expect(elementAtPath(root, '9.9')).toBeNull();
  });
});
