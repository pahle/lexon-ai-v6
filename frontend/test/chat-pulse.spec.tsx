import { expect, it } from 'vitest';
import {
  HideAnswerPulseContext,
  MarkdownText,
} from '../src/components/chat/markdown-text.js';
import { render } from './render.js';

it('35R2: the assistant-ui pulse dot is suppressed on the Markdown wrapper while hidden', async () => {
  const view = await render(
    <HideAnswerPulseContext.Provider value>
      <MarkdownText source="Text" />
    </HideAnswerPulseContext.Provider>,
  );
  try {
    const wrapper = view.container.querySelector<HTMLElement>('.aui-md')!;
    expect(wrapper.className).toContain('after:content-none!');
    expect(wrapper.className).toContain('[&_*]:after:content-none!');
  } finally {
    await view.unmount();
  }
});

it('35R2: the pulse dot keeps its default while streaming text is shown', async () => {
  const view = await render(<MarkdownText source="Text" />);
  try {
    const wrapper = view.container.querySelector<HTMLElement>('.aui-md')!;
    expect(wrapper.className).not.toContain('after:content-none!');
  } finally {
    await view.unmount();
  }
});
