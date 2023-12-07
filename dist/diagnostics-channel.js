"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.imapCommandChannel = exports.DiagnosticsChannel = void 0;
var _dcPolyfill = _interopRequireDefault(require("dc-polyfill"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _classPrivateFieldInitSpec(obj, privateMap, value) { _checkPrivateRedeclaration(obj, privateMap); privateMap.set(obj, value); }
function _checkPrivateRedeclaration(obj, privateCollection) { if (privateCollection.has(obj)) { throw new TypeError("Cannot initialize the same private elements twice on an object"); } }
function _classPrivateFieldGet(receiver, privateMap) { var descriptor = _classExtractFieldDescriptor(receiver, privateMap, "get"); return _classApplyDescriptorGet(receiver, descriptor); }
function _classApplyDescriptorGet(receiver, descriptor) { if (descriptor.get) { return descriptor.get.call(receiver); } return descriptor.value; }
function _classPrivateFieldSet(receiver, privateMap, value) { var descriptor = _classExtractFieldDescriptor(receiver, privateMap, "set"); _classApplyDescriptorSet(receiver, descriptor, value); return value; }
function _classExtractFieldDescriptor(receiver, privateMap, action) { if (!privateMap.has(receiver)) { throw new TypeError("attempted to " + action + " private field on non-instance"); } return privateMap.get(receiver); }
function _classApplyDescriptorSet(receiver, descriptor, value) { if (descriptor.set) { descriptor.set.call(receiver, value); } else { if (!descriptor.writable) { throw new TypeError("attempted to set read only private field"); } descriptor.value = value; } }
var _channelName = /*#__PURE__*/new WeakMap();
class DiagnosticsChannel {
  constructor(channelName) {
    _classPrivateFieldInitSpec(this, _channelName, {
      writable: true,
      value: void 0
    });
    _classPrivateFieldSet(this, _channelName, channelName);
    this.channel = _dcPolyfill.default.channel(channelName);
  }
  publish(data) {
    this.channel.publish(data);
  }
  subscribe(cb) {
    _dcPolyfill.default.subscribe(_classPrivateFieldGet(this, _channelName), cb);
  }
  unsubscribe(cb) {
    _dcPolyfill.default.unsubscribe(_classPrivateFieldGet(this, _channelName), cb);
  }
  hasSubscribers() {
    return this.channel.hasSubscribers;
  }
}
exports.DiagnosticsChannel = DiagnosticsChannel;
const imapCommandChannel = new DiagnosticsChannel('emailjs-imap-client:command');
exports.imapCommandChannel = imapCommandChannel;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZGNQb2x5ZmlsbCIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwib2JqIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJfY2xhc3NQcml2YXRlRmllbGRJbml0U3BlYyIsInByaXZhdGVNYXAiLCJ2YWx1ZSIsIl9jaGVja1ByaXZhdGVSZWRlY2xhcmF0aW9uIiwic2V0IiwicHJpdmF0ZUNvbGxlY3Rpb24iLCJoYXMiLCJUeXBlRXJyb3IiLCJfY2xhc3NQcml2YXRlRmllbGRHZXQiLCJyZWNlaXZlciIsImRlc2NyaXB0b3IiLCJfY2xhc3NFeHRyYWN0RmllbGREZXNjcmlwdG9yIiwiX2NsYXNzQXBwbHlEZXNjcmlwdG9yR2V0IiwiZ2V0IiwiY2FsbCIsIl9jbGFzc1ByaXZhdGVGaWVsZFNldCIsIl9jbGFzc0FwcGx5RGVzY3JpcHRvclNldCIsImFjdGlvbiIsIndyaXRhYmxlIiwiX2NoYW5uZWxOYW1lIiwiV2Vha01hcCIsIkRpYWdub3N0aWNzQ2hhbm5lbCIsImNvbnN0cnVjdG9yIiwiY2hhbm5lbE5hbWUiLCJjaGFubmVsIiwiZGlhZ25vc3RpY3NfY2hhbm5lbCIsInB1Ymxpc2giLCJkYXRhIiwic3Vic2NyaWJlIiwiY2IiLCJ1bnN1YnNjcmliZSIsImhhc1N1YnNjcmliZXJzIiwiZXhwb3J0cyIsImltYXBDb21tYW5kQ2hhbm5lbCJdLCJzb3VyY2VzIjpbIi4uL3NyYy9kaWFnbm9zdGljcy1jaGFubmVsLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBkaWFnbm9zdGljc19jaGFubmVsIGZyb20gJ2RjLXBvbHlmaWxsJztcblxuZXhwb3J0IGNsYXNzIERpYWdub3N0aWNzQ2hhbm5lbCB7XG4gICNjaGFubmVsTmFtZTtcblxuICBjb25zdHJ1Y3RvcihjaGFubmVsTmFtZSkge1xuICAgIHRoaXMuI2NoYW5uZWxOYW1lID0gY2hhbm5lbE5hbWU7XG4gICAgdGhpcy5jaGFubmVsID0gZGlhZ25vc3RpY3NfY2hhbm5lbC5jaGFubmVsKGNoYW5uZWxOYW1lKTtcbiAgfVxuXG4gIHB1Ymxpc2goZGF0YSkge1xuICAgIHRoaXMuY2hhbm5lbC5wdWJsaXNoKGRhdGEpO1xuICB9XG5cbiAgc3Vic2NyaWJlKGNiKSB7XG4gICAgZGlhZ25vc3RpY3NfY2hhbm5lbC5zdWJzY3JpYmUodGhpcy4jY2hhbm5lbE5hbWUsIGNiKTtcbiAgfTtcblxuICB1bnN1YnNjcmliZShjYikge1xuICAgIGRpYWdub3N0aWNzX2NoYW5uZWwudW5zdWJzY3JpYmUodGhpcy4jY2hhbm5lbE5hbWUsIGNiKTtcbiAgfTtcblxuICBoYXNTdWJzY3JpYmVycygpIHtcbiAgICByZXR1cm4gdGhpcy5jaGFubmVsLmhhc1N1YnNjcmliZXJzO1xuICB9XG59XG5cbmV4cG9ydCBjb25zdCBpbWFwQ29tbWFuZENoYW5uZWwgPSBuZXcgRGlhZ25vc3RpY3NDaGFubmVsKCdlbWFpbGpzLWltYXAtY2xpZW50OmNvbW1hbmQnKTtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsSUFBQUEsV0FBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBQThDLFNBQUFELHVCQUFBRSxHQUFBLFdBQUFBLEdBQUEsSUFBQUEsR0FBQSxDQUFBQyxVQUFBLEdBQUFELEdBQUEsS0FBQUUsT0FBQSxFQUFBRixHQUFBO0FBQUEsU0FBQUcsMkJBQUFILEdBQUEsRUFBQUksVUFBQSxFQUFBQyxLQUFBLElBQUFDLDBCQUFBLENBQUFOLEdBQUEsRUFBQUksVUFBQSxHQUFBQSxVQUFBLENBQUFHLEdBQUEsQ0FBQVAsR0FBQSxFQUFBSyxLQUFBO0FBQUEsU0FBQUMsMkJBQUFOLEdBQUEsRUFBQVEsaUJBQUEsUUFBQUEsaUJBQUEsQ0FBQUMsR0FBQSxDQUFBVCxHQUFBLGVBQUFVLFNBQUE7QUFBQSxTQUFBQyxzQkFBQUMsUUFBQSxFQUFBUixVQUFBLFFBQUFTLFVBQUEsR0FBQUMsNEJBQUEsQ0FBQUYsUUFBQSxFQUFBUixVQUFBLGlCQUFBVyx3QkFBQSxDQUFBSCxRQUFBLEVBQUFDLFVBQUE7QUFBQSxTQUFBRSx5QkFBQUgsUUFBQSxFQUFBQyxVQUFBLFFBQUFBLFVBQUEsQ0FBQUcsR0FBQSxXQUFBSCxVQUFBLENBQUFHLEdBQUEsQ0FBQUMsSUFBQSxDQUFBTCxRQUFBLFlBQUFDLFVBQUEsQ0FBQVIsS0FBQTtBQUFBLFNBQUFhLHNCQUFBTixRQUFBLEVBQUFSLFVBQUEsRUFBQUMsS0FBQSxRQUFBUSxVQUFBLEdBQUFDLDRCQUFBLENBQUFGLFFBQUEsRUFBQVIsVUFBQSxVQUFBZSx3QkFBQSxDQUFBUCxRQUFBLEVBQUFDLFVBQUEsRUFBQVIsS0FBQSxVQUFBQSxLQUFBO0FBQUEsU0FBQVMsNkJBQUFGLFFBQUEsRUFBQVIsVUFBQSxFQUFBZ0IsTUFBQSxTQUFBaEIsVUFBQSxDQUFBSyxHQUFBLENBQUFHLFFBQUEsZUFBQUYsU0FBQSxtQkFBQVUsTUFBQSwrQ0FBQWhCLFVBQUEsQ0FBQVksR0FBQSxDQUFBSixRQUFBO0FBQUEsU0FBQU8seUJBQUFQLFFBQUEsRUFBQUMsVUFBQSxFQUFBUixLQUFBLFFBQUFRLFVBQUEsQ0FBQU4sR0FBQSxJQUFBTSxVQUFBLENBQUFOLEdBQUEsQ0FBQVUsSUFBQSxDQUFBTCxRQUFBLEVBQUFQLEtBQUEsaUJBQUFRLFVBQUEsQ0FBQVEsUUFBQSxjQUFBWCxTQUFBLGdEQUFBRyxVQUFBLENBQUFSLEtBQUEsR0FBQUEsS0FBQTtBQUFBLElBQUFpQixZQUFBLG9CQUFBQyxPQUFBO0FBRXZDLE1BQU1DLGtCQUFrQixDQUFDO0VBRzlCQyxXQUFXQSxDQUFDQyxXQUFXLEVBQUU7SUFBQXZCLDBCQUFBLE9BQUFtQixZQUFBO01BQUFELFFBQUE7TUFBQWhCLEtBQUE7SUFBQTtJQUN2QmEscUJBQUEsS0FBSSxFQUFBSSxZQUFBLEVBQWdCSSxXQUFXO0lBQy9CLElBQUksQ0FBQ0MsT0FBTyxHQUFHQyxtQkFBbUIsQ0FBQ0QsT0FBTyxDQUFDRCxXQUFXLENBQUM7RUFDekQ7RUFFQUcsT0FBT0EsQ0FBQ0MsSUFBSSxFQUFFO0lBQ1osSUFBSSxDQUFDSCxPQUFPLENBQUNFLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDO0VBQzVCO0VBRUFDLFNBQVNBLENBQUNDLEVBQUUsRUFBRTtJQUNaSixtQkFBbUIsQ0FBQ0csU0FBUyxDQUFBcEIscUJBQUEsQ0FBQyxJQUFJLEVBQUFXLFlBQUEsR0FBZVUsRUFBRSxDQUFDO0VBQ3REO0VBRUFDLFdBQVdBLENBQUNELEVBQUUsRUFBRTtJQUNkSixtQkFBbUIsQ0FBQ0ssV0FBVyxDQUFBdEIscUJBQUEsQ0FBQyxJQUFJLEVBQUFXLFlBQUEsR0FBZVUsRUFBRSxDQUFDO0VBQ3hEO0VBRUFFLGNBQWNBLENBQUEsRUFBRztJQUNmLE9BQU8sSUFBSSxDQUFDUCxPQUFPLENBQUNPLGNBQWM7RUFDcEM7QUFDRjtBQUFDQyxPQUFBLENBQUFYLGtCQUFBLEdBQUFBLGtCQUFBO0FBRU0sTUFBTVksa0JBQWtCLEdBQUcsSUFBSVosa0JBQWtCLENBQUMsNkJBQTZCLENBQUM7QUFBQ1csT0FBQSxDQUFBQyxrQkFBQSxHQUFBQSxrQkFBQSJ9