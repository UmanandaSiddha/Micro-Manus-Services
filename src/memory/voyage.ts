/** Voyage AI embeddings — our key, server-side only (docs/memory.md). */
const MODEL = 'voyage-3.5'; // 1024 dims — must match vector(1024) in the schema

export async function embed(
  texts: string[],
  inputType: 'document' | 'query',
): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not configured');
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, input: texts, input_type: inputType }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Voyage HTTP ${res.status}`);
  const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return body.data.map((d) => d.embedding);
}

export const toVectorLiteral = (v: number[]): string => `[${v.join(',')}]`;

export const memoryEnabled = (): boolean => !!process.env.VOYAGE_API_KEY;
