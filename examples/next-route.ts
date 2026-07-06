// Next.js route handler example (app/api/seal/route.ts). Zero bundler config:
// the wasm is inlined inside bte-sdk and initializes lazily on first use.
//
// POST /api/seal { message: string, inSecs?: number }
// -> { conditionId, ctHash }
import { BteClient } from 'bte-sdk';

const client = new BteClient({ url: process.env.BTE_DEVNET_URL ?? 'http://localhost:8080' });

export async function POST(request: Request): Promise<Response> {
  const { message, inSecs = 60 } = await request.json();
  if (typeof message !== 'string' || message.length === 0) {
    return Response.json({ error: 'message required' }, { status: 400 });
  }
  const conditionId = await client.condition({ in: inSecs });
  const { ctHash } = await client.seal(message, conditionId);
  return Response.json({ conditionId, ctHash });
}
