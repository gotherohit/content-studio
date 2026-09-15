import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { availablePort, launchArguments } from '../server/jupyter.js';

test('Jupyter runs directly, binds loopback, and cannot silently switch ports', () => {
  const args = launchArguments(8891, 'test-token', 'D:/test content studio/notebooks');
  assert.deepEqual(args.slice(0, 2), ['-m', 'jupyterlab']);
  assert.ok(args.includes('--ServerApp.ip=127.0.0.1'));
  assert.ok(args.includes('--ServerApp.port_retries=0'));
  assert.ok(args.includes('--IdentityProvider.token=test-token'));
  assert.ok(args.includes('--ServerApp.root_dir=D:/test content studio/notebooks'));
  assert.ok(args.includes(`--LabApp.workspaces_dir=${path.join('D:/test content studio/notebooks', '.jupyter', 'workspaces')}`));
  assert.ok(!args.includes('--ServerApp.disable_check_xsrf=True'));
});

test('an occupied Jupyter port is skipped without stopping its owner', async (t) => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const port = occupied.address().port;
  assert.ok(await availablePort(port) > port);
  assert.equal(occupied.listening, true);
});
