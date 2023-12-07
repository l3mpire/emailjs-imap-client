"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = createDefaultLogger;
var _common = require("./common");
let SESSIONCOUNTER = 0;
function createDefaultLogger(username, hostname) {
  const session = ++SESSIONCOUNTER;
  const log = (level, messages) => {
    messages = messages.map(msg => typeof msg === 'function' ? msg() : msg);
    const date = new Date().toISOString();
    const logMessage = `[${date}][${session}][${username}][${hostname}] ${messages.join(' ')}`;
    if (level === _common.LOG_LEVEL_DEBUG) {
      console.log('[DEBUG]' + logMessage);
    } else if (level === _common.LOG_LEVEL_INFO) {
      console.info('[INFO]' + logMessage);
    } else if (level === _common.LOG_LEVEL_WARN) {
      console.warn('[WARN]' + logMessage);
    } else if (level === _common.LOG_LEVEL_ERROR) {
      console.error('[ERROR]' + logMessage);
    }
  };
  return {
    debug: msgs => log(_common.LOG_LEVEL_DEBUG, msgs),
    info: msgs => log(_common.LOG_LEVEL_INFO, msgs),
    warn: msgs => log(_common.LOG_LEVEL_WARN, msgs),
    error: msgs => log(_common.LOG_LEVEL_ERROR, msgs)
  };
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfY29tbW9uIiwicmVxdWlyZSIsIlNFU1NJT05DT1VOVEVSIiwiY3JlYXRlRGVmYXVsdExvZ2dlciIsInVzZXJuYW1lIiwiaG9zdG5hbWUiLCJzZXNzaW9uIiwibG9nIiwibGV2ZWwiLCJtZXNzYWdlcyIsIm1hcCIsIm1zZyIsImRhdGUiLCJEYXRlIiwidG9JU09TdHJpbmciLCJsb2dNZXNzYWdlIiwiam9pbiIsIkxPR19MRVZFTF9ERUJVRyIsImNvbnNvbGUiLCJMT0dfTEVWRUxfSU5GTyIsImluZm8iLCJMT0dfTEVWRUxfV0FSTiIsIndhcm4iLCJMT0dfTEVWRUxfRVJST1IiLCJlcnJvciIsImRlYnVnIiwibXNncyJdLCJzb3VyY2VzIjpbIi4uL3NyYy9sb2dnZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgTE9HX0xFVkVMX0VSUk9SLFxuICBMT0dfTEVWRUxfV0FSTixcbiAgTE9HX0xFVkVMX0lORk8sXG4gIExPR19MRVZFTF9ERUJVR1xufSBmcm9tICcuL2NvbW1vbidcblxubGV0IFNFU1NJT05DT1VOVEVSID0gMFxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0TG9nZ2VyICh1c2VybmFtZSwgaG9zdG5hbWUpIHtcbiAgY29uc3Qgc2Vzc2lvbiA9ICsrU0VTU0lPTkNPVU5URVJcbiAgY29uc3QgbG9nID0gKGxldmVsLCBtZXNzYWdlcykgPT4ge1xuICAgIG1lc3NhZ2VzID0gbWVzc2FnZXMubWFwKG1zZyA9PiB0eXBlb2YgbXNnID09PSAnZnVuY3Rpb24nID8gbXNnKCkgOiBtc2cpXG4gICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBgWyR7ZGF0ZX1dWyR7c2Vzc2lvbn1dWyR7dXNlcm5hbWV9XVske2hvc3RuYW1lfV0gJHttZXNzYWdlcy5qb2luKCcgJyl9YFxuICAgIGlmIChsZXZlbCA9PT0gTE9HX0xFVkVMX0RFQlVHKSB7XG4gICAgICBjb25zb2xlLmxvZygnW0RFQlVHXScgKyBsb2dNZXNzYWdlKVxuICAgIH0gZWxzZSBpZiAobGV2ZWwgPT09IExPR19MRVZFTF9JTkZPKSB7XG4gICAgICBjb25zb2xlLmluZm8oJ1tJTkZPXScgKyBsb2dNZXNzYWdlKVxuICAgIH0gZWxzZSBpZiAobGV2ZWwgPT09IExPR19MRVZFTF9XQVJOKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ1tXQVJOXScgKyBsb2dNZXNzYWdlKVxuICAgIH0gZWxzZSBpZiAobGV2ZWwgPT09IExPR19MRVZFTF9FUlJPUikge1xuICAgICAgY29uc29sZS5lcnJvcignW0VSUk9SXScgKyBsb2dNZXNzYWdlKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGVidWc6IG1zZ3MgPT4gbG9nKExPR19MRVZFTF9ERUJVRywgbXNncyksXG4gICAgaW5mbzogbXNncyA9PiBsb2coTE9HX0xFVkVMX0lORk8sIG1zZ3MpLFxuICAgIHdhcm46IG1zZ3MgPT4gbG9nKExPR19MRVZFTF9XQVJOLCBtc2dzKSxcbiAgICBlcnJvcjogbXNncyA9PiBsb2coTE9HX0xFVkVMX0VSUk9SLCBtc2dzKVxuICB9XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLElBQUFBLE9BQUEsR0FBQUMsT0FBQTtBQU9BLElBQUlDLGNBQWMsR0FBRyxDQUFDO0FBRVAsU0FBU0MsbUJBQW1CQSxDQUFFQyxRQUFRLEVBQUVDLFFBQVEsRUFBRTtFQUMvRCxNQUFNQyxPQUFPLEdBQUcsRUFBRUosY0FBYztFQUNoQyxNQUFNSyxHQUFHLEdBQUdBLENBQUNDLEtBQUssRUFBRUMsUUFBUSxLQUFLO0lBQy9CQSxRQUFRLEdBQUdBLFFBQVEsQ0FBQ0MsR0FBRyxDQUFDQyxHQUFHLElBQUksT0FBT0EsR0FBRyxLQUFLLFVBQVUsR0FBR0EsR0FBRyxFQUFFLEdBQUdBLEdBQUcsQ0FBQztJQUN2RSxNQUFNQyxJQUFJLEdBQUcsSUFBSUMsSUFBSSxFQUFFLENBQUNDLFdBQVcsRUFBRTtJQUNyQyxNQUFNQyxVQUFVLEdBQUksSUFBR0gsSUFBSyxLQUFJTixPQUFRLEtBQUlGLFFBQVMsS0FBSUMsUUFBUyxLQUFJSSxRQUFRLENBQUNPLElBQUksQ0FBQyxHQUFHLENBQUUsRUFBQztJQUMxRixJQUFJUixLQUFLLEtBQUtTLHVCQUFlLEVBQUU7TUFDN0JDLE9BQU8sQ0FBQ1gsR0FBRyxDQUFDLFNBQVMsR0FBR1EsVUFBVSxDQUFDO0lBQ3JDLENBQUMsTUFBTSxJQUFJUCxLQUFLLEtBQUtXLHNCQUFjLEVBQUU7TUFDbkNELE9BQU8sQ0FBQ0UsSUFBSSxDQUFDLFFBQVEsR0FBR0wsVUFBVSxDQUFDO0lBQ3JDLENBQUMsTUFBTSxJQUFJUCxLQUFLLEtBQUthLHNCQUFjLEVBQUU7TUFDbkNILE9BQU8sQ0FBQ0ksSUFBSSxDQUFDLFFBQVEsR0FBR1AsVUFBVSxDQUFDO0lBQ3JDLENBQUMsTUFBTSxJQUFJUCxLQUFLLEtBQUtlLHVCQUFlLEVBQUU7TUFDcENMLE9BQU8sQ0FBQ00sS0FBSyxDQUFDLFNBQVMsR0FBR1QsVUFBVSxDQUFDO0lBQ3ZDO0VBQ0YsQ0FBQztFQUVELE9BQU87SUFDTFUsS0FBSyxFQUFFQyxJQUFJLElBQUluQixHQUFHLENBQUNVLHVCQUFlLEVBQUVTLElBQUksQ0FBQztJQUN6Q04sSUFBSSxFQUFFTSxJQUFJLElBQUluQixHQUFHLENBQUNZLHNCQUFjLEVBQUVPLElBQUksQ0FBQztJQUN2Q0osSUFBSSxFQUFFSSxJQUFJLElBQUluQixHQUFHLENBQUNjLHNCQUFjLEVBQUVLLElBQUksQ0FBQztJQUN2Q0YsS0FBSyxFQUFFRSxJQUFJLElBQUluQixHQUFHLENBQUNnQix1QkFBZSxFQUFFRyxJQUFJO0VBQzFDLENBQUM7QUFDSCJ9