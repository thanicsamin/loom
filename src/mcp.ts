import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const endpoint = process.env.STUDIO_TOOL_ENDPOINT, token = process.env.STUDIO_TOOL_TOKEN, chatId = process.env.STUDIO_CHAT_ID;
if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+\/tools$/.test(endpoint) || !token || !chatId) throw Error('Missing Studio tool bridge.');
async function call(method: string, data: unknown) {
  const response = await fetch(endpoint!, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ method, chatId, data }), signal: AbortSignal.timeout(60000) });
  const result: any = await response.json(); if (!response.ok) throw Error(result.error || 'Tool bridge failed.'); return result;
}
const server = new Server({ name: 'loom-studio', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await call('list', {}) }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try { return await call(request.params.name, request.params.arguments || {}); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed.' }] }; }
});
void server.connect(new StdioServerTransport());
