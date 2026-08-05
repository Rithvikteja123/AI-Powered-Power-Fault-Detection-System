/**
 * In-memory ring buffer for telemetry ingestion.
 *
 * Design rationale:
 *   - POST /api/telemetry must return < 5ms even at 500+ msg/s
 *   - Direct synchronous DB writes cannot sustain this rate
 *   - Ring buffer absorbs bursts; a worker drains it into the DB every 100ms
 *   - Buffer size 50,000 handles a 5,000-msg burst with headroom
 */

const BUFFER_SIZE = 50_000;

class IngestQueue {
  constructor() {
    this._buf   = new Array(BUFFER_SIZE);
    this._head  = 0;   // next write slot
    this._tail  = 0;   // next read slot
    this._count = 0;
    this._dropped = 0;
  }

  push(msg) {
    if (this._count >= BUFFER_SIZE) {
      this._dropped++;
      console.warn(`[Queue] Buffer full — dropped message (total dropped: ${this._dropped})`);
      return false;
    }
    this._buf[this._head] = msg;
    this._head = (this._head + 1) % BUFFER_SIZE;
    this._count++;
    return true;
  }

  /** Drain up to `maxItems` messages. Returns array. */
  drain(maxItems = 500) {
    const batch = [];
    while (this._count > 0 && batch.length < maxItems) {
      batch.push(this._buf[this._tail]);
      this._buf[this._tail] = null; // free reference
      this._tail = (this._tail + 1) % BUFFER_SIZE;
      this._count--;
    }
    return batch;
  }

  get size()    { return this._count; }
  get dropped() { return this._dropped; }
}

// Singleton
const queue = new IngestQueue();
module.exports = queue;
