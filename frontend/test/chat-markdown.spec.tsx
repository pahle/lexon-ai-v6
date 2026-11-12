import { expect, it, vi } from 'vitest';
import { MarkdownText } from '../src/components/chat/markdown-text.js';
import { render } from './render.js';

it('drops unsafe HTML, javascript links, and remote images without fetching them', async () => {
  const requests = vi.spyOn(globalThis, 'fetch');
  const view = await render(
    <MarkdownText
      source={
        'Safe text\n\n<img src="https://remote.invalid/pixel"><script>run()</script> [open](javascript:alert(1))'
      }
    />,
  );
  try {
    expect(view.container.querySelector('script, img')).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(view.container.textContent).toContain('Safe text');
    expect(requests).not.toHaveBeenCalled();
  } finally {
    requests.mockRestore();
    await view.unmount();
  }
});
