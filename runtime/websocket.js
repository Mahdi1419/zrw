import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payload = Buffer.alloc(0), fin = true) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let head;
  if (data.length < 126) {
    head = Buffer.allocUnsafe(2);
    head[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
    head[1] = data.length;
  } else if (data.length <= 0xffff) {
    head = Buffer.allocUnsafe(4);
    head[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.allocUnsafe(10);
    head[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([head, data]);
}

export class ServerWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(socket, { maxPayload = 64 * 1024 * 1024 } = {}) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.readyState = ServerWebSocket.OPEN;
    this.binaryType = 'arraybuffer';
    this._buffer = Buffer.alloc(0);
    this._fragmentOpcode = null;
    this._fragments = [];
    this._fragmentBytes = 0;
    this._closeEmitted = false;
    // Prevent EventEmitter from treating an early socket error as an uncaught exception.
    this.on('error', () => {});

    socket.on('data', (chunk) => this._feed(chunk));
    socket.on('error', (error) => this.emit('error', error));
    socket.on('close', () => this._finishClose());
    socket.on('end', () => this._finishClose());
  }

  get bufferedAmount() {
    return this.socket?.writableLength || 0;
  }

  accept() {}

  addEventListener(type, listener) {
    if (type === 'message') this.on('message', (data) => listener({ data }));
    else if (type === 'close') this.on('close', (event) => listener(event || {}));
    else if (type === 'error') this.on('error', (error) => listener(error));
    else this.on(type, listener);
  }

  send(data) {
    if (this.readyState !== ServerWebSocket.OPEN) throw new Error('WebSocket is not open');
    let opcode = 0x2;
    let payload;
    if (typeof data === 'string') {
      opcode = 0x1;
      payload = Buffer.from(data);
    } else if (data instanceof ArrayBuffer) {
      payload = Buffer.from(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else if (Buffer.isBuffer(data)) {
      payload = data;
    } else {
      payload = Buffer.from(data);
    }
    this.socket.write(encodeFrame(opcode, payload));
  }

  close(code = 1000, reason = '') {
    if (this.readyState === ServerWebSocket.CLOSED || this.readyState === ServerWebSocket.CLOSING) return;
    this.readyState = ServerWebSocket.CLOSING;
    let payload = Buffer.alloc(0);
    if (code) {
      const reasonBytes = Buffer.from(String(reason)).subarray(0, 123);
      payload = Buffer.allocUnsafe(2 + reasonBytes.length);
      payload.writeUInt16BE(code, 0);
      reasonBytes.copy(payload, 2);
    }
    try { this.socket.write(encodeFrame(0x8, payload)); } catch {}
    try { this.socket.end(); } catch {}
    setTimeout(() => {
      if (this.readyState !== ServerWebSocket.CLOSED) {
        try { this.socket.destroy(); } catch {}
      }
    }, 1000).unref?.();
  }

  _finishClose(code = 1000, reason = '') {
    if (this._closeEmitted) return;
    this._closeEmitted = true;
    this.readyState = ServerWebSocket.CLOSED;
    this.emit('close', { code, reason });
  }

  _protocolError(message = 'Protocol error') {
    try { this.close(1002, message); } catch {}
  }

  _tooLarge() {
    try { this.close(1009, 'Payload Too Large'); } catch {}
  }

  _deliver(opcode, payload) {
    if (payload.length > this.maxPayload) return this._tooLarge();
    if (opcode === 0x1) {
      this.emit('message', payload.toString('utf8'));
    } else if (opcode === 0x2) {
      if (this.binaryType === 'arraybuffer') {
        const copy = Uint8Array.from(payload);
        this.emit('message', copy.buffer);
      } else {
        this.emit('message', Uint8Array.from(payload));
      }
    }
  }

  _handleDataFrame(fin, opcode, payload) {
    if (opcode === 0x0) {
      if (this._fragmentOpcode === null) return this._protocolError();
      this._fragments.push(payload);
      this._fragmentBytes += payload.length;
      if (this._fragmentBytes > this.maxPayload) return this._tooLarge();
      if (fin) {
        const message = Buffer.concat(this._fragments, this._fragmentBytes);
        const initialOpcode = this._fragmentOpcode;
        this._fragmentOpcode = null;
        this._fragments = [];
        this._fragmentBytes = 0;
        this._deliver(initialOpcode, message);
      }
      return;
    }

    if (opcode !== 0x1 && opcode !== 0x2) return this._protocolError();
    if (this._fragmentOpcode !== null) return this._protocolError();
    if (fin) return this._deliver(opcode, payload);

    this._fragmentOpcode = opcode;
    this._fragments = [payload];
    this._fragmentBytes = payload.length;
    if (this._fragmentBytes > this.maxPayload) this._tooLarge();
  }

  _feed(chunk) {
    if (this.readyState === ServerWebSocket.CLOSED) return;
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : Buffer.from(chunk);

    while (this._buffer.length >= 2) {
      const b0 = this._buffer[0];
      const b1 = this._buffer[1];
      const fin = !!(b0 & 0x80);
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const masked = !!(b1 & 0x80);
      let length = b1 & 0x7f;
      let offset = 2;

      if (rsv !== 0 || !masked) return this._protocolError();
      if (length === 126) {
        if (this._buffer.length < 4) return;
        length = this._buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this._buffer.length < 10) return;
        const big = this._buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) return this._tooLarge();
        length = Number(big);
        offset = 10;
      }

      const isControl = opcode >= 0x8;
      if (isControl && (!fin || length > 125)) return this._protocolError();
      if (!isControl && length > this.maxPayload) return this._tooLarge();
      if (this._buffer.length < offset + 4 + length) return;

      const mask = this._buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.allocUnsafe(length);
      for (let i = 0; i < length; i++) payload[i] = this._buffer[offset + i] ^ mask[i & 3];
      this._buffer = this._buffer.subarray(offset + length);

      if (opcode === 0x8) {
        let code = 1000;
        let reason = '';
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.subarray(2).toString('utf8');
        }
        if (this.readyState === ServerWebSocket.OPEN) {
          this.readyState = ServerWebSocket.CLOSING;
          try { this.socket.write(encodeFrame(0x8, payload)); } catch {}
        }
        try { this.socket.end(); } catch {}
        this._finishClose(code, reason);
        return;
      }
      if (opcode === 0x9) {
        try { this.socket.write(encodeFrame(0xA, payload)); } catch {}
        continue;
      }
      if (opcode === 0xA) continue;
      this._handleDataFrame(fin, opcode, payload);
    }
  }
}

export function acceptWebSocketUpgrade(req, socket, head, options = {}) {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (!key || version !== '13' || upgrade !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }

  const accept = createHash('sha1').update(String(key) + GUID).digest('base64');
  const requestedProtocols = String(req.headers['sec-websocket-protocol'] || '')
    .split(',').map((v) => v.trim()).filter(Boolean);
  const selectedProtocol = requestedProtocols[0] || null;

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`
  ];
  if (selectedProtocol) responseHeaders.push(`Sec-WebSocket-Protocol: ${selectedProtocol}`);
  responseHeaders.push('\r\n');
  socket.write(responseHeaders.join('\r\n'));

  const ws = new ServerWebSocket(socket, options);
  if (head?.length) ws._feed(head);
  return ws;
}
