"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = Compressor;
var _zstream = _interopRequireDefault(require("pako/lib/zlib/zstream"));
var _deflate = require("pako/lib/zlib/deflate");
var _inflate = require("pako/lib/zlib/inflate");
var _messages = _interopRequireDefault(require("pako/lib/zlib/messages.js"));
var _constants = require("pako/lib/zlib/constants");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
const CHUNK_SIZE = 16384;
const WINDOW_BITS = 15;

/**
 * Handles de-/compression via #inflate() and #deflate(), calls you back via #deflatedReady() and #inflatedReady().
 * The chunk we get from deflater is actually a view of a 16kB arraybuffer, so we need to copy the relevant parts
 * memory to a new arraybuffer.
 */
function Compressor(inflatedReady, deflatedReady) {
  this.inflatedReady = inflatedReady;
  this.deflatedReady = deflatedReady;
  this._inflate = inflater(chunk => this.inflatedReady(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length)));
  this._deflate = deflater(chunk => this.deflatedReady(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length)));
}
Compressor.prototype.inflate = function (buffer) {
  this._inflate(new Uint8Array(buffer));
};
Compressor.prototype.deflate = function (buffer) {
  this._deflate(new Uint8Array(buffer));
};
function deflater(emit) {
  const stream = new _zstream.default();
  const status = (0, _deflate.deflateInit2)(stream, _constants.Z_DEFAULT_COMPRESSION, _constants.Z_DEFLATED, WINDOW_BITS, 8, _constants.Z_DEFAULT_STRATEGY);
  if (status !== _constants.Z_OK) {
    throw new Error('Problem initializing deflate stream: ' + _messages.default[status]);
  }
  return function (data) {
    if (data === undefined) return emit();

    // Attach the input data
    stream.input = data;
    stream.next_in = 0;
    stream.avail_in = stream.input.length;
    let status;
    let output;
    let start;
    let ret = true;
    do {
      // When the stream gets full, we need to create new space.
      if (stream.avail_out === 0) {
        stream.output = new Uint8Array(CHUNK_SIZE);
        start = stream.next_out = 0;
        stream.avail_out = CHUNK_SIZE;
      }

      // Perform the deflate
      status = (0, _deflate.deflate)(stream, _constants.Z_SYNC_FLUSH);
      if (status !== _constants.Z_STREAM_END && status !== _constants.Z_OK) {
        throw new Error('Deflate problem: ' + _messages.default[status]);
      }

      // If the output buffer got full, flush the data.
      if (stream.avail_out === 0 && stream.next_out > start) {
        output = stream.output.subarray(start, start = stream.next_out);
        ret = emit(output);
      }
    } while ((stream.avail_in > 0 || stream.avail_out === 0) && status !== _constants.Z_STREAM_END);

    // Emit whatever is left in output.
    if (stream.next_out > start) {
      output = stream.output.subarray(start, start = stream.next_out);
      ret = emit(output);
    }
    return ret;
  };
}
function inflater(emit) {
  const stream = new _zstream.default();
  const status = (0, _inflate.inflateInit2)(stream, WINDOW_BITS);
  if (status !== _constants.Z_OK) {
    throw new Error('Problem initializing inflate stream: ' + _messages.default[status]);
  }
  return function (data) {
    if (data === undefined) return emit();
    let start;
    stream.input = data;
    stream.next_in = 0;
    stream.avail_in = stream.input.length;
    let status, output;
    let ret = true;
    do {
      if (stream.avail_out === 0) {
        stream.output = new Uint8Array(CHUNK_SIZE);
        start = stream.next_out = 0;
        stream.avail_out = CHUNK_SIZE;
      }
      status = (0, _inflate.inflate)(stream, _constants.Z_NO_FLUSH);
      if (status !== _constants.Z_STREAM_END && status !== _constants.Z_OK) {
        throw new Error('inflate problem: ' + _messages.default[status]);
      }
      if (stream.next_out) {
        if (stream.avail_out === 0 || status === _constants.Z_STREAM_END) {
          output = stream.output.subarray(start, start = stream.next_out);
          ret = emit(output);
        }
      }
    } while (stream.avail_in > 0 && status !== _constants.Z_STREAM_END);
    if (stream.next_out > start) {
      output = stream.output.subarray(start, start = stream.next_out);
      ret = emit(output);
    }
    return ret;
  };
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfenN0cmVhbSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX2RlZmxhdGUiLCJfaW5mbGF0ZSIsIl9tZXNzYWdlcyIsIl9jb25zdGFudHMiLCJvYmoiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsIkNIVU5LX1NJWkUiLCJXSU5ET1dfQklUUyIsIkNvbXByZXNzb3IiLCJpbmZsYXRlZFJlYWR5IiwiZGVmbGF0ZWRSZWFkeSIsImluZmxhdGVyIiwiY2h1bmsiLCJidWZmZXIiLCJzbGljZSIsImJ5dGVPZmZzZXQiLCJsZW5ndGgiLCJkZWZsYXRlciIsInByb3RvdHlwZSIsImluZmxhdGUiLCJVaW50OEFycmF5IiwiZGVmbGF0ZSIsImVtaXQiLCJzdHJlYW0iLCJaU3RyZWFtIiwic3RhdHVzIiwiZGVmbGF0ZUluaXQyIiwiWl9ERUZBVUxUX0NPTVBSRVNTSU9OIiwiWl9ERUZMQVRFRCIsIlpfREVGQVVMVF9TVFJBVEVHWSIsIlpfT0siLCJFcnJvciIsIm1lc3NhZ2VzIiwiZGF0YSIsInVuZGVmaW5lZCIsImlucHV0IiwibmV4dF9pbiIsImF2YWlsX2luIiwib3V0cHV0Iiwic3RhcnQiLCJyZXQiLCJhdmFpbF9vdXQiLCJuZXh0X291dCIsIlpfU1lOQ19GTFVTSCIsIlpfU1RSRUFNX0VORCIsInN1YmFycmF5IiwiaW5mbGF0ZUluaXQyIiwiWl9OT19GTFVTSCJdLCJzb3VyY2VzIjpbIi4uL3NyYy9jb21wcmVzc2lvbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgWlN0cmVhbSBmcm9tICdwYWtvL2xpYi96bGliL3pzdHJlYW0nXG5pbXBvcnQgeyBkZWZsYXRlSW5pdDIsIGRlZmxhdGUgfSBmcm9tICdwYWtvL2xpYi96bGliL2RlZmxhdGUnXG5pbXBvcnQgeyBpbmZsYXRlLCBpbmZsYXRlSW5pdDIgfSBmcm9tICdwYWtvL2xpYi96bGliL2luZmxhdGUnXG5pbXBvcnQgbWVzc2FnZXMgZnJvbSAncGFrby9saWIvemxpYi9tZXNzYWdlcy5qcydcbmltcG9ydCB7XG4gIFpfTk9fRkxVU0gsIFpfU1lOQ19GTFVTSCwgWl9PSyxcbiAgWl9TVFJFQU1fRU5ELCBaX0RFRkFVTFRfQ09NUFJFU1NJT04sXG4gIFpfREVGQVVMVF9TVFJBVEVHWSwgWl9ERUZMQVRFRFxufSBmcm9tICdwYWtvL2xpYi96bGliL2NvbnN0YW50cydcblxuY29uc3QgQ0hVTktfU0laRSA9IDE2Mzg0XG5jb25zdCBXSU5ET1dfQklUUyA9IDE1XG5cbi8qKlxuICogSGFuZGxlcyBkZS0vY29tcHJlc3Npb24gdmlhICNpbmZsYXRlKCkgYW5kICNkZWZsYXRlKCksIGNhbGxzIHlvdSBiYWNrIHZpYSAjZGVmbGF0ZWRSZWFkeSgpIGFuZCAjaW5mbGF0ZWRSZWFkeSgpLlxuICogVGhlIGNodW5rIHdlIGdldCBmcm9tIGRlZmxhdGVyIGlzIGFjdHVhbGx5IGEgdmlldyBvZiBhIDE2a0IgYXJyYXlidWZmZXIsIHNvIHdlIG5lZWQgdG8gY29weSB0aGUgcmVsZXZhbnQgcGFydHNcbiAqIG1lbW9yeSB0byBhIG5ldyBhcnJheWJ1ZmZlci5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQ29tcHJlc3NvciAoaW5mbGF0ZWRSZWFkeSwgZGVmbGF0ZWRSZWFkeSkge1xuICB0aGlzLmluZmxhdGVkUmVhZHkgPSBpbmZsYXRlZFJlYWR5XG4gIHRoaXMuZGVmbGF0ZWRSZWFkeSA9IGRlZmxhdGVkUmVhZHlcbiAgdGhpcy5faW5mbGF0ZSA9IGluZmxhdGVyKGNodW5rID0+IHRoaXMuaW5mbGF0ZWRSZWFkeShjaHVuay5idWZmZXIuc2xpY2UoY2h1bmsuYnl0ZU9mZnNldCwgY2h1bmsuYnl0ZU9mZnNldCArIGNodW5rLmxlbmd0aCkpKVxuICB0aGlzLl9kZWZsYXRlID0gZGVmbGF0ZXIoY2h1bmsgPT4gdGhpcy5kZWZsYXRlZFJlYWR5KGNodW5rLmJ1ZmZlci5zbGljZShjaHVuay5ieXRlT2Zmc2V0LCBjaHVuay5ieXRlT2Zmc2V0ICsgY2h1bmsubGVuZ3RoKSkpXG59XG5cbkNvbXByZXNzb3IucHJvdG90eXBlLmluZmxhdGUgPSBmdW5jdGlvbiAoYnVmZmVyKSB7XG4gIHRoaXMuX2luZmxhdGUobmV3IFVpbnQ4QXJyYXkoYnVmZmVyKSlcbn1cblxuQ29tcHJlc3Nvci5wcm90b3R5cGUuZGVmbGF0ZSA9IGZ1bmN0aW9uIChidWZmZXIpIHtcbiAgdGhpcy5fZGVmbGF0ZShuZXcgVWludDhBcnJheShidWZmZXIpKVxufVxuXG5mdW5jdGlvbiBkZWZsYXRlciAoZW1pdCkge1xuICBjb25zdCBzdHJlYW0gPSBuZXcgWlN0cmVhbSgpXG4gIGNvbnN0IHN0YXR1cyA9IGRlZmxhdGVJbml0MihzdHJlYW0sIFpfREVGQVVMVF9DT01QUkVTU0lPTiwgWl9ERUZMQVRFRCwgV0lORE9XX0JJVFMsIDgsIFpfREVGQVVMVF9TVFJBVEVHWSlcbiAgaWYgKHN0YXR1cyAhPT0gWl9PSykge1xuICAgIHRocm93IG5ldyBFcnJvcignUHJvYmxlbSBpbml0aWFsaXppbmcgZGVmbGF0ZSBzdHJlYW06ICcgKyBtZXNzYWdlc1tzdGF0dXNdKVxuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgaWYgKGRhdGEgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGVtaXQoKVxuXG4gICAgLy8gQXR0YWNoIHRoZSBpbnB1dCBkYXRhXG4gICAgc3RyZWFtLmlucHV0ID0gZGF0YVxuICAgIHN0cmVhbS5uZXh0X2luID0gMFxuICAgIHN0cmVhbS5hdmFpbF9pbiA9IHN0cmVhbS5pbnB1dC5sZW5ndGhcblxuICAgIGxldCBzdGF0dXNcbiAgICBsZXQgb3V0cHV0XG4gICAgbGV0IHN0YXJ0XG4gICAgbGV0IHJldCA9IHRydWVcblxuICAgIGRvIHtcbiAgICAgIC8vIFdoZW4gdGhlIHN0cmVhbSBnZXRzIGZ1bGwsIHdlIG5lZWQgdG8gY3JlYXRlIG5ldyBzcGFjZS5cbiAgICAgIGlmIChzdHJlYW0uYXZhaWxfb3V0ID09PSAwKSB7XG4gICAgICAgIHN0cmVhbS5vdXRwdXQgPSBuZXcgVWludDhBcnJheShDSFVOS19TSVpFKVxuICAgICAgICBzdGFydCA9IHN0cmVhbS5uZXh0X291dCA9IDBcbiAgICAgICAgc3RyZWFtLmF2YWlsX291dCA9IENIVU5LX1NJWkVcbiAgICAgIH1cblxuICAgICAgLy8gUGVyZm9ybSB0aGUgZGVmbGF0ZVxuICAgICAgc3RhdHVzID0gZGVmbGF0ZShzdHJlYW0sIFpfU1lOQ19GTFVTSClcbiAgICAgIGlmIChzdGF0dXMgIT09IFpfU1RSRUFNX0VORCAmJiBzdGF0dXMgIT09IFpfT0spIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEZWZsYXRlIHByb2JsZW06ICcgKyBtZXNzYWdlc1tzdGF0dXNdKVxuICAgICAgfVxuXG4gICAgICAvLyBJZiB0aGUgb3V0cHV0IGJ1ZmZlciBnb3QgZnVsbCwgZmx1c2ggdGhlIGRhdGEuXG4gICAgICBpZiAoc3RyZWFtLmF2YWlsX291dCA9PT0gMCAmJiBzdHJlYW0ubmV4dF9vdXQgPiBzdGFydCkge1xuICAgICAgICBvdXRwdXQgPSBzdHJlYW0ub3V0cHV0LnN1YmFycmF5KHN0YXJ0LCBzdGFydCA9IHN0cmVhbS5uZXh0X291dClcbiAgICAgICAgcmV0ID0gZW1pdChvdXRwdXQpXG4gICAgICB9XG4gICAgfSB3aGlsZSAoKHN0cmVhbS5hdmFpbF9pbiA+IDAgfHwgc3RyZWFtLmF2YWlsX291dCA9PT0gMCkgJiYgc3RhdHVzICE9PSBaX1NUUkVBTV9FTkQpXG5cbiAgICAvLyBFbWl0IHdoYXRldmVyIGlzIGxlZnQgaW4gb3V0cHV0LlxuICAgIGlmIChzdHJlYW0ubmV4dF9vdXQgPiBzdGFydCkge1xuICAgICAgb3V0cHV0ID0gc3RyZWFtLm91dHB1dC5zdWJhcnJheShzdGFydCwgc3RhcnQgPSBzdHJlYW0ubmV4dF9vdXQpXG4gICAgICByZXQgPSBlbWl0KG91dHB1dClcbiAgICB9XG4gICAgcmV0dXJuIHJldFxuICB9XG59XG5cbmZ1bmN0aW9uIGluZmxhdGVyIChlbWl0KSB7XG4gIGNvbnN0IHN0cmVhbSA9IG5ldyBaU3RyZWFtKClcblxuICBjb25zdCBzdGF0dXMgPSBpbmZsYXRlSW5pdDIoc3RyZWFtLCBXSU5ET1dfQklUUylcbiAgaWYgKHN0YXR1cyAhPT0gWl9PSykge1xuICAgIHRocm93IG5ldyBFcnJvcignUHJvYmxlbSBpbml0aWFsaXppbmcgaW5mbGF0ZSBzdHJlYW06ICcgKyBtZXNzYWdlc1tzdGF0dXNdKVxuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgaWYgKGRhdGEgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGVtaXQoKVxuXG4gICAgbGV0IHN0YXJ0XG4gICAgc3RyZWFtLmlucHV0ID0gZGF0YVxuICAgIHN0cmVhbS5uZXh0X2luID0gMFxuICAgIHN0cmVhbS5hdmFpbF9pbiA9IHN0cmVhbS5pbnB1dC5sZW5ndGhcblxuICAgIGxldCBzdGF0dXMsIG91dHB1dFxuICAgIGxldCByZXQgPSB0cnVlXG5cbiAgICBkbyB7XG4gICAgICBpZiAoc3RyZWFtLmF2YWlsX291dCA9PT0gMCkge1xuICAgICAgICBzdHJlYW0ub3V0cHV0ID0gbmV3IFVpbnQ4QXJyYXkoQ0hVTktfU0laRSlcbiAgICAgICAgc3RhcnQgPSBzdHJlYW0ubmV4dF9vdXQgPSAwXG4gICAgICAgIHN0cmVhbS5hdmFpbF9vdXQgPSBDSFVOS19TSVpFXG4gICAgICB9XG5cbiAgICAgIHN0YXR1cyA9IGluZmxhdGUoc3RyZWFtLCBaX05PX0ZMVVNIKVxuICAgICAgaWYgKHN0YXR1cyAhPT0gWl9TVFJFQU1fRU5EICYmIHN0YXR1cyAhPT0gWl9PSykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2luZmxhdGUgcHJvYmxlbTogJyArIG1lc3NhZ2VzW3N0YXR1c10pXG4gICAgICB9XG5cbiAgICAgIGlmIChzdHJlYW0ubmV4dF9vdXQpIHtcbiAgICAgICAgaWYgKHN0cmVhbS5hdmFpbF9vdXQgPT09IDAgfHwgc3RhdHVzID09PSBaX1NUUkVBTV9FTkQpIHtcbiAgICAgICAgICBvdXRwdXQgPSBzdHJlYW0ub3V0cHV0LnN1YmFycmF5KHN0YXJ0LCBzdGFydCA9IHN0cmVhbS5uZXh0X291dClcbiAgICAgICAgICByZXQgPSBlbWl0KG91dHB1dClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gd2hpbGUgKChzdHJlYW0uYXZhaWxfaW4gPiAwKSAmJiBzdGF0dXMgIT09IFpfU1RSRUFNX0VORClcblxuICAgIGlmIChzdHJlYW0ubmV4dF9vdXQgPiBzdGFydCkge1xuICAgICAgb3V0cHV0ID0gc3RyZWFtLm91dHB1dC5zdWJhcnJheShzdGFydCwgc3RhcnQgPSBzdHJlYW0ubmV4dF9vdXQpXG4gICAgICByZXQgPSBlbWl0KG91dHB1dClcbiAgICB9XG5cbiAgICByZXR1cm4gcmV0XG4gIH1cbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsSUFBQUEsUUFBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUMsUUFBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUsUUFBQSxHQUFBRixPQUFBO0FBQ0EsSUFBQUcsU0FBQSxHQUFBSixzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUksVUFBQSxHQUFBSixPQUFBO0FBSWdDLFNBQUFELHVCQUFBTSxHQUFBLFdBQUFBLEdBQUEsSUFBQUEsR0FBQSxDQUFBQyxVQUFBLEdBQUFELEdBQUEsS0FBQUUsT0FBQSxFQUFBRixHQUFBO0FBRWhDLE1BQU1HLFVBQVUsR0FBRyxLQUFLO0FBQ3hCLE1BQU1DLFdBQVcsR0FBRyxFQUFFOztBQUV0QjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ2UsU0FBU0MsVUFBVUEsQ0FBRUMsYUFBYSxFQUFFQyxhQUFhLEVBQUU7RUFDaEUsSUFBSSxDQUFDRCxhQUFhLEdBQUdBLGFBQWE7RUFDbEMsSUFBSSxDQUFDQyxhQUFhLEdBQUdBLGFBQWE7RUFDbEMsSUFBSSxDQUFDVixRQUFRLEdBQUdXLFFBQVEsQ0FBQ0MsS0FBSyxJQUFJLElBQUksQ0FBQ0gsYUFBYSxDQUFDRyxLQUFLLENBQUNDLE1BQU0sQ0FBQ0MsS0FBSyxDQUFDRixLQUFLLENBQUNHLFVBQVUsRUFBRUgsS0FBSyxDQUFDRyxV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