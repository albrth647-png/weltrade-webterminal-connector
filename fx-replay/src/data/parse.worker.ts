import { parseCsv } from './csv';

type Request = { id: number; text: string; name: string };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, text, name } = event.data;
  try {
    const parsed = parseCsv(text, name);
    const c = parsed.columns;
    self.postMessage(
      { id, ok: true, parsed },
      [c.time.buffer, c.open.buffer, c.high.buffer, c.low.buffer, c.close.buffer, c.volume.buffer],
    );
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
