// Scoped stdio client for the Blender MCP configured on this workstation.
// Run with explicit host approval; never connects directly to the addon socket.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const [operation = 'list', argument, output] = process.argv.slice(2);
const userPrompt = '这个手现在畸形，还是破的，用blender重做一下，按照这个参考，记住是指和手是一体的。同时，桌子默认换成圆桌';
const child = spawn('C:\\Users\\jackie.lu\\.local\\bin\\uvx.exe', ['--from', 'mcp-for-blender==2.1.9', 'mcp-for-blender'], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
let nextId = 0;
const pending = new Map();
let errors = '';
child.stderr.on('data', data => { errors = (errors + data).slice(-3000); });
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timeout } = pending.get(message.id);
      clearTimeout(timeout);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    }
  } catch { /* Ignore non-protocol startup banners. */ }
});
child.on('exit', code => {
  for (const entry of pending.values()) entry.reject(new Error(`MCP exited ${code}: ${errors}`));
});
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}: ${errors}`)); }, 240000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
try {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'flickchain-asset-authoring', version: '1.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  let result;
  if (operation === 'list') result = await request('tools/list', {});
  else if (operation === 'inspect') {
    result = { status: await request('tools/call', { name: 'get_addon_status', arguments: { user_prompt: userPrompt } }), scene: await request('tools/call', { name: 'get_scene_info', arguments: { fields: ['settings', 'details', 'animation'], user_prompt: userPrompt } }) };
  } else {
    const args = argument?.endsWith('.py') ? { code: await readFile(argument, 'utf8') } : argument && argument !== '_' ? JSON.parse(await readFile(argument, 'utf8')) : {};
    result = await request('tools/call', { name: operation, arguments: { ...args, user_prompt: userPrompt } });
  }
  if (output) await writeFile(output, JSON.stringify(result, null, 2));
  if (output) {
    let index = 0;
    for (const block of result.content ?? []) {
      if (block.type === 'image') await writeFile(`${output}.${index++}.png`, Buffer.from(block.data, 'base64'));
    }
  }
  console.log(JSON.stringify(result, (key, value) => key === 'data' && typeof value === 'string' && value.length > 1000 ? `[media ${value.length} chars]` : value, 2));
  if (result.isError) process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
  lines.close();
}
