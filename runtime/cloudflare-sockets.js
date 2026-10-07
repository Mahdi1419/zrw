import net from 'node:net';
import { createHash } from 'node:crypto';

function normalizeHost(hostname) {
  const h = String(hostname ?? '');
  if (h.startsWith('[') && h.endsWith(']')) return h.slice(1, -1);
  return h;
}

export function md5Digest(data) {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Promise.resolve(new Uint8Array(createHash('md5').update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest()));
}

export function connect({ hostname, port }) {
  const socket = net.createConnection({ host: normalizeHost(hostname), port: Number(port), allowHalfOpen: false });
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30_000);

  let openedResolve;
  let openedReject;
  let closedResolve;
  let settledOpen = false;

  const opened = new Promise((resolve, reject) => {
    openedResolve = resolve;
    openedReject = reject;
  });
  const closed = new Promise((resolve, reject) => {
    closedResolve = resolve;
  });

  socket.once('connect', () => {
    settledOpen = true;
    openedResolve();
  });
  socket.once('error', (err) => {
    if (!settledOpen) openedReject(err);
  });
  socket.once('close', () => {
    closedResolve();
  });

  let readableController;
  let readableClosed = false;
  const readable = new ReadableStream({
    type: 'bytes',
    start(controller) {
      readableController = controller;
      socket.on('data', (chunk) => {
        if (readableClosed) return;
        const copy = new Uint8Array(chunk.byteLength);
        copy.set(chunk);
        try { controller.enqueue(copy); } catch { /* stream already closed */ }
      });
      socket.on('end', () => {
        if (readableClosed) return;
        readableClosed = true;
        try { controller.close(); } catch {}
      });
      socket.on('error', (err) => {
        if (readableClosed) return;
        readableClosed = true;
        try { controller.error(err); } catch {}
      });
      socket.on('close', () => {
        if (readableClosed) return;
        readableClosed = true;
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      socket.destroy();
    }
  });

  const writable = new WritableStream({
    async write(chunk) {
      if (socket.destroyed) throw new Error('Socket is closed');
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      await new Promise((resolve, reject) => {
        socket.write(buf, (err) => err ? reject(err) : resolve());
      });
    },
    close() {
      return new Promise((resolve) => socket.end(resolve));
    },
    abort(reason) {
      socket.destroy(reason instanceof Error ? reason : undefined);
    }
  });

  return {
    readable,
    writable,
    opened,
    closed,
    close() {
      try { socket.destroy(); } catch {}
    },
    get rawSocket() { return socket; }
  };
}
