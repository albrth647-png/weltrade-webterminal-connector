import { parseCsv } from './csv';

type Request = { id: number; buffer: ArrayBuffer; name: string };

/** Descomprime si el archivo trae la firma gzip (1F 8B), como los `*.csv.gz` de syntx-historico. */
async function toText(buffer: ArrayBuffer): Promise<string> {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  const gzipped = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
  if (!gzipped) return new Response(buffer).text();
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, buffer, name } = event.data;
  try {
    const text = await toText(buffer);
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
