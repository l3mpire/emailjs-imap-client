"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildFETCHCommand = buildFETCHCommand;
exports.buildSEARCHCommand = buildSEARCHCommand;
exports.buildSTORECommand = buildSTORECommand;
exports.buildXOAuth2Token = buildXOAuth2Token;
var _emailjsImapHandler = require("emailjs-imap-handler");
var _emailjsMimeCodec = require("emailjs-mime-codec");
var _emailjsBase = require("emailjs-base64");
var _common = require("./common");
/**
 * Builds a FETCH command
 *
 * @param {String} sequence Message range selector
 * @param {Array} items List of elements to fetch (eg. `['uid', 'envelope']`).
 * @param {Object} [options] Optional options object. Use `{byUid:true}` for `UID FETCH`
 * @returns {Object} Structured IMAP command
 */
function buildFETCHCommand(sequence, items, options) {
  const command = {
    command: options.byUid ? 'UID FETCH' : 'FETCH',
    attributes: [{
      type: 'SEQUENCE',
      value: sequence
    }]
  };
  if (options.valueAsString !== undefined) {
    command.valueAsString = options.valueAsString;
  }
  let query = [];
  items.forEach(item => {
    item = item.toUpperCase().trim();
    if (/^\w+$/.test(item)) {
      // alphanum strings can be used directly
      query.push({
        type: 'ATOM',
        value: item
      });
    } else if (item) {
      try {
        // parse the value as a fake command, use only the attributes block
        const cmd = (0, _emailjsImapHandler.parser)((0, _common.toTypedArray)('* Z ' + item));
        query = query.concat(cmd.attributes || []);
      } catch (e) {
        // if parse failed, use the original string as one entity
        query.push({
          type: 'ATOM',
          value: item
        });
      }
    }
  });
  if (query.length === 1) {
    query = query.pop();
  }
  command.attributes.push(query);
  if (options.changedSince) {
    command.attributes.push([{
      type: 'ATOM',
      value: 'CHANGEDSINCE'
    }, {
      type: 'ATOM',
      value: options.changedSince
    }]);
  }
  return command;
}

/**
 * Builds a login token for XOAUTH2 authentication command
 *
 * @param {String} user E-mail address of the user
 * @param {String} token Valid access token for the user
 * @return {String} Base64 formatted login token
 */
function buildXOAuth2Token(user = '', token) {
  const authData = [`user=${user}`, `auth=Bearer ${token}`, '', ''];
  return (0, _emailjsBase.encode)(authData.join('\x01'));
}

/**
 * Compiles a search query into an IMAP command. Queries are composed as objects
 * where keys are search terms and values are term arguments. Only strings,
 * numbers and Dates are used. If the value is an array, the members of it
 * are processed separately (use this for terms that require multiple params).
 * If the value is a Date, it is converted to the form of "01-Jan-1970".
 * Subqueries (OR, NOT) are made up of objects
 *
 *    {unseen: true, header: ["subject", "hello world"]};
 *    SEARCH UNSEEN HEADER "subject" "hello world"
 *
 * @param {Object} query Search query
 * @param {Object} [options] Option object
 * @param {Boolean} [options.byUid] If ture, use UID SEARCH instead of SEARCH
 * @return {Object} IMAP command object
 */
function buildSEARCHCommand(query = {}, options = {}) {
  const command = {
    command: options.byUid ? 'UID SEARCH' : 'SEARCH'
  };
  let isAscii = true;
  const buildTerm = query => {
    let list = [];
    Object.keys(query).forEach(key => {
      let params = [];
      const formatDate = date => date.toUTCString().replace(/^\w+, 0?(\d+) (\w+) (\d+).*/, '$1-$2-$3');
      const escapeParam = param => {
        if (typeof param === 'number') {
          return {
            type: 'number',
            value: param
          };
        } else if (typeof param === 'string') {
          if (/[\u0080-\uFFFF]/.test(param)) {
            isAscii = false;
            return {
              type: 'literal',
              value: (0, _common.fromTypedArray)((0, _emailjsMimeCodec.encode)(param)) // cast unicode string to pseudo-binary as imap-handler compiles strings as octets
            };
          }

          return {
            type: 'string',
            value: param
          };
        } else if (Object.prototype.toString.call(param) === '[object Date]') {
          // RFC 3501 allows for dates to be placed in
          // double-quotes or left without quotes.  Some
          // servers (Yandex), do not like the double quotes,
          // so we treat the date as an atom.
          return {
            type: 'atom',
            value: formatDate(param)
          };
        } else if (Array.isArray(param)) {
          return param.map(escapeParam);
        } else if (typeof param === 'object') {
          return buildTerm(param);
        }
      };
      params.push({
        type: 'atom',
        value: key.toUpperCase()
      });
      [].concat(query[key] || []).forEach(param => {
        switch (key.toLowerCase()) {
          case 'uid':
            param = {
              type: 'sequence',
              value: param
            };
            break;
          // The Gmail extension values of X-GM-THRID and
          // X-GM-MSGID are defined to be unsigned 64-bit integers
          // and they must not be quoted strings or the server
          // will report a parse error.
          case 'x-gm-thrid':
          case 'x-gm-msgid':
            param = {
              type: 'number',
              value: param
            };
            break;
          default:
            param = escapeParam(param);
        }
        if (param) {
          params = params.concat(param || []);
        }
      });
      list = list.concat(params || []);
    });
    return list;
  };
  command.attributes = buildTerm(query);

  // If any string input is using 8bit bytes, prepend the optional CHARSET argument
  if (!isAscii) {
    command.attributes.unshift({
      type: 'atom',
      value: 'UTF-8'
    });
    command.attributes.unshift({
      type: 'atom',
      value: 'CHARSET'
    });
  }
  return command;
}

/**
 * Creates an IMAP STORE command from the selected arguments
 */
function buildSTORECommand(sequence, action = '', flags = [], options = {}) {
  const command = {
    command: options.byUid ? 'UID STORE' : 'STORE',
    attributes: [{
      type: 'sequence',
      value: sequence
    }]
  };
  command.attributes.push({
    type: 'atom',
    value: action.toUpperCase() + (options.silent ? '.SILENT' : '')
  });
  command.attributes.push(flags.map(flag => {
    return {
      type: 'atom',
      value: flag
    };
  }));
  return command;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZW1haWxqc0ltYXBIYW5kbGVyIiwicmVxdWlyZSIsIl9lbWFpbGpzTWltZUNvZGVjIiwiX2VtYWlsanNCYXNlIiwiX2NvbW1vbiIsImJ1aWxkRkVUQ0hDb21tYW5kIiwic2VxdWVuY2UiLCJpdGVtcyIsIm9wdGlvbnMiLCJjb21tYW5kIiwiYnlVaWQiLCJhdHRyaWJ1dGVzIiwidHlwZSIsInZhbHVlIiwidmFsdWVBc1N0cmluZyIsInVuZGVmaW5lZCIsInF1ZXJ5IiwiZm9yRWFjaCIsIml0ZW0iLCJ0b1VwcGVyQ2FzZSIsInRyaW0iLCJ0ZXN0IiwicHVzaCIsImNtZCIsInBhcnNlciIsInRvVHlwZWRBcnJheSIsImNvbmNhdCIsImUiLCJsZW5ndGgiLCJwb3AiLCJjaGFuZ2VkU2luY2UiLCJidWlsZFhPQXV0aDJUb2tlbiIsInVzZXIiLCJ0b2tlbiIsImF1dGhEYXRhIiwiZW5jb2RlQmFzZTY0Iiwiam9pbiIsImJ1aWxkU0VBUkNIQ29tbWFuZCIsImlzQXNjaWkiLCJidWlsZFRlcm0iLCJsaXN0IiwiT2JqZWN0Iiwia2V5cyIsImtleSIsInBhcmFtcyIsImZvcm1hdERhdGUiLCJkYXRlIiwidG9VVENTdHJpbmciLCJyZXBsYWNlIiwiZXNjYXBlUGFyYW0iLCJwYXJhbSIsImZyb21UeXBlZEFycmF5IiwiZW5jb2RlIiwicHJvdG90eXBlIiwidG9TdHJpbmciLCJjYWxsIiwiQXJyYXkiLCJpc0FycmF5IiwibWFwIiwidG9Mb3dlckNhc2UiLCJ1bnNoaWZ0IiwiYnVpbGRTVE9SRUNvbW1hbmQiLCJhY3Rpb24iLCJmbGFncyIsInNpbGVudCIsImZsYWciXSwic291cmNlcyI6WyIuLi9zcmMvY29tbWFuZC1idWlsZGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHBhcnNlciB9IGZyb20gJ2VtYWlsanMtaW1hcC1oYW5kbGVyJ1xuaW1wb3J0IHsgZW5jb2RlIH0gZnJvbSAnZW1haWxqcy1taW1lLWNvZGVjJ1xuaW1wb3J0IHsgZW5jb2RlIGFzIGVuY29kZUJhc2U2NCB9IGZyb20gJ2VtYWlsanMtYmFzZTY0J1xuaW1wb3J0IHtcbiAgZnJvbVR5cGVkQXJyYXksXG4gIHRvVHlwZWRBcnJheVxufSBmcm9tICcuL2NvbW1vbidcblxuLyoqXG4gKiBCdWlsZHMgYSBGRVRDSCBjb21tYW5kXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHNlcXVlbmNlIE1lc3NhZ2UgcmFuZ2Ugc2VsZWN0b3JcbiAqIEBwYXJhbSB7QXJyYXl9IGl0ZW1zIExpc3Qgb2YgZWxlbWVudHMgdG8gZmV0Y2ggKGVnLiBgWyd1aWQnLCAnZW52ZWxvcGUnXWApLlxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSBPcHRpb25hbCBvcHRpb25zIG9iamVjdC4gVXNlIGB7YnlVaWQ6dHJ1ZX1gIGZvciBgVUlEIEZFVENIYFxuICogQHJldHVybnMge09iamVjdH0gU3RydWN0dXJlZCBJTUFQIGNvbW1hbmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRkVUQ0hDb21tYW5kIChzZXF1ZW5jZSwgaXRlbXMsIG9wdGlvbnMpIHtcbiAgY29uc3QgY29tbWFuZCA9IHtcbiAgICBjb21tYW5kOiBvcHRpb25zLmJ5VWlkID8gJ1VJRCBGRVRDSCcgOiAnRkVUQ0gnLFxuICAgIGF0dHJpYnV0ZXM6IFt7XG4gICAgICB0eXBlOiAnU0VRVUVOQ0UnLFxuICAgICAgdmFsdWU6IHNlcXVlbmNlXG4gICAgfV1cbiAgfVxuXG4gIGlmIChvcHRpb25zLnZhbHVlQXNTdHJpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbW1hbmQudmFsdWVBc1N0cmluZyA9IG9wdGlvbnMudmFsdWVBc1N0cmluZ1xuICB9XG5cbiAgbGV0IHF1ZXJ5ID0gW11cblxuICBpdGVtcy5mb3JFYWNoKChpdGVtKSA9PiB7XG4gICAgaXRlbSA9IGl0ZW0udG9VcHBlckNhc2UoKS50cmltKClcblxuICAgIGlmICgvXlxcdyskLy50ZXN0KGl0ZW0pKSB7XG4gICAgICAvLyBhbHBoYW51bSBzdHJpbmdzIGNhbiBiZSB1c2VkIGRpcmVjdGx5XG4gICAgICBxdWVyeS5wdXNoKHtcbiAgICAgICAgdHlwZTogJ0FUT00nLFxuICAgICAgICB2YWx1ZTogaXRlbVxuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKGl0ZW0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIHBhcnNlIHRoZSB2YWx1ZSBhcyBhIGZha2UgY29tbWFuZCwgdXNlIG9ubHkgdGhlIGF0dHJpYnV0ZXMgYmxvY2tcbiAgICAgICAgY29uc3QgY21kID0gcGFyc2VyKHRvVHlwZWRBcnJheSgnKiBaICcgKyBpdGVtKSlcbiAgICAgICAgcXVlcnkgPSBxdWVyeS5jb25jYXQoY21kLmF0dHJpYnV0ZXMgfHwgW10pXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIGlmIHBhcnNlIGZhaWxlZCwgdXNlIHRoZSBvcmlnaW5hbCBzdHJpbmcgYXMgb25lIGVudGl0eVxuICAgICAgICBxdWVyeS5wdXNoKHtcbiAgICAgICAgICB0eXBlOiAnQVRPTScsXG4gICAgICAgICAgdmFsdWU6IGl0ZW1cbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG4gIH0pXG5cbiAgaWYgKHF1ZXJ5Lmxlbmd0aCA9PT0gMSkge1xuICAgIHF1ZXJ5ID0gcXVlcnkucG9wKClcbiAgfVxuXG4gIGNvbW1hbmQuYXR0cmlidXRlcy5wdXNoKHF1ZXJ5KVxuXG4gIGlmIChvcHRpb25zLmNoYW5nZWRTaW5jZSkge1xuICAgIGNvbW1hbmQuYXR0cmlidXRlcy5wdXNoKFt7XG4gICAgICB0eXBlOiAnQVRPTScsXG4gICAgICB2YWx1ZTogJ0NIQU5HRURTSU5DRSdcbiAgICB9LCB7XG4gICAgICB0eXBlOiAnQVRPTScsXG4gICAgICB2YWx1ZTogb3B0aW9ucy5jaGFuZ2VkU2luY2VcbiAgICB9XSlcbiAgfVxuXG4gIHJldHVybiBjb21tYW5kXG59XG5cbi8qKlxuICogQnVpbGRzIGEgbG9naW4gdG9rZW4gZm9yIFhPQVVUSDIgYXV0aGVudGljYXRpb24gY29tbWFuZFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1c2VyIEUtbWFpbCBhZGRyZXNzIG9mIHRoZSB1c2VyXG4gKiBAcGFyYW0ge1N0cmluZ30gdG9rZW4gVmFsaWQgYWNjZXNzIHRva2VuIGZvciB0aGUgdXNlclxuICogQHJldHVybiB7U3RyaW5nfSBCYXNlNjQgZm9ybWF0dGVkIGxvZ2luIHRva2VuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFhPQXV0aDJUb2tlbiAodXNlciA9ICcnLCB0b2tlbikge1xuICBjb25zdCBhdXRoRGF0YSA9IFtcbiAgICBgdXNlcj0ke3VzZXJ9YCxcbiAgICBgYXV0aD1CZWFyZXIgJHt0b2tlbn1gLFxuICAgICcnLFxuICAgICcnXG4gIF1cbiAgcmV0dXJuIGVuY29kZUJhc2U2NChhdXRoRGF0YS5qb2luKCdcXHgwMScpKVxufVxuXG4vKipcbiAqIENvbXBpbGVzIGEgc2VhcmNoIHF1ZXJ5IGludG8gYW4gSU1BUCBjb21tYW5kLiBRdWVyaWVzIGFyZSBjb21wb3NlZCBhcyBvYmplY3RzXG4gKiB3aGVyZSBrZXlzIGFyZSBzZWFyY2ggdGVybXMgYW5kIHZhbHVlcyBhcmUgdGVybSBhcmd1bWVudHMuIE9ubHkgc3RyaW5ncyxcbiAqIG51bWJlcnMgYW5kIERhdGVzIGFyZSB1c2VkLiBJZiB0aGUgdmFsdWUgaXMgYW4gYXJyYXksIHRoZSBtZW1iZXJzIG9mIGl0XG4gKiBhcmUgcHJvY2Vzc2VkIHNlcGFyYXRlbHkgKHVzZSB0aGlzIGZvciB0ZXJtcyB0aGF0IHJlcXVpcmUgbXVsdGlwbGUgcGFyYW1zKS5cbiAqIElmIHRoZSB2YWx1ZSBpcyBhIERhdGUsIGl0IGlzIGNvbnZlcnRlZCB0byB0aGUgZm9ybSBvZiBcIjAxLUphbi0xOTcwXCIuXG4gKiBTdWJxdWVyaWVzIChPUiwgTk9UKSBhcmUgbWFkZSB1cCBvZiBvYmplY3RzXG4gKlxuICogICAge3Vuc2VlbjogdHJ1ZSwgaGVhZGVyOiBbXCJzdWJqZWN0XCIsIFwiaGVsbG8gd29ybGRcIl19O1xuICogICAgU0VBUkNIIFVOU0VFTiBIRUFERVIgXCJzdWJqZWN0XCIgXCJoZWxsbyB3b3JsZFwiXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IHF1ZXJ5IFNlYXJjaCBxdWVyeVxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSBPcHRpb24gb2JqZWN0XG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtvcHRpb25zLmJ5VWlkXSBJZiB0dXJlLCB1c2UgVUlEIFNFQVJDSCBpbnN0ZWFkIG9mIFNFQVJDSFxuICogQHJldHVybiB7T2JqZWN0fSBJTUFQIGNvbW1hbmQgb2JqZWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFNFQVJDSENvbW1hbmQgKHF1ZXJ5ID0ge30sIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBjb21tYW5kID0ge1xuICAgIGNvbW1hbmQ6IG9wdGlvbnMuYnlVaWQgPyAnVUlEIFNFQVJDSCcgOiAnU0VBUkNIJ1xuICB9XG5cbiAgbGV0IGlzQXNjaWkgPSB0cnVlXG5cbiAgY29uc3QgYnVpbGRUZXJtID0gKHF1ZXJ5KSA9PiB7XG4gICAgbGV0IGxpc3QgPSBbXVxuXG4gICAgT2JqZWN0LmtleXMocXVlcnkpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgbGV0IHBhcmFtcyA9IFtdXG4gICAgICBjb25zdCBmb3JtYXREYXRlID0gKGRhdGUpID0+IGRhdGUudG9VVENTdHJpbmcoKS5yZXBsYWNlKC9eXFx3KywgMD8oXFxkKykgKFxcdyspIChcXGQrKS4qLywgJyQxLSQyLSQzJylcbiAgICAgIGNvbnN0IGVzY2FwZVBhcmFtID0gKHBhcmFtKSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgcGFyYW0gPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgdmFsdWU6IHBhcmFtXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBwYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBpZiAoL1tcXHUwMDgwLVxcdUZGRkZdLy50ZXN0KHBhcmFtKSkge1xuICAgICAgICAgICAgaXNBc2NpaSA9IGZhbHNlXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICB0eXBlOiAnbGl0ZXJhbCcsXG4gICAgICAgICAgICAgIHZhbHVlOiBmcm9tVHlwZWRBcnJheShlbmNvZGUocGFyYW0pKSAvLyBjYXN0IHVuaWNvZGUgc3RyaW5nIHRvIHBzZXVkby1iaW5hcnkgYXMgaW1hcC1oYW5kbGVyIGNvbXBpbGVzIHN0cmluZ3MgYXMgb2N0ZXRzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHZhbHVlOiBwYXJhbVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwocGFyYW0pID09PSAnW29iamVjdCBEYXRlXScpIHtcbiAgICAgICAgICAvLyBSRkMgMzUwMSBhbGxvd3MgZm9yIGRhdGVzIHRvIGJlIHBsYWNlZCBpblxuICAgICAgICAgIC8vIGRvdWJsZS1xdW90ZXMgb3IgbGVmdCB3aXRob3V0IHF1b3Rlcy4gIFNvbWVcbiAgICAgICAgICAvLyBzZXJ2ZXJzIChZYW5kZXgpLCBkbyBub3QgbGlrZSB0aGUgZG91YmxlIHF1b3RlcyxcbiAgICAgICAgICAvLyBzbyB3ZSB0cmVhdCB0aGUgZGF0ZSBhcyBhbiBhdG9tLlxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiAnYXRvbScsXG4gICAgICAgICAgICB2YWx1ZTogZm9ybWF0RGF0ZShwYXJhbSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShwYXJhbSkpIHtcbiAgICAgICAgICByZXR1cm4gcGFyYW0ubWFwKGVzY2FwZVBhcmFtKVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBwYXJhbSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICByZXR1cm4gYnVpbGRUZXJtKHBhcmFtKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHBhcmFtcy5wdXNoKHtcbiAgICAgICAgdHlwZTogJ2F0b20nLFxuICAgICAgICB2YWx1ZToga2V5LnRvVXBwZXJDYXNlKClcbiAgICAgIH0pO1xuXG4gICAgICBbXS5jb25jYXQocXVlcnlba2V5XSB8fCBbXSkuZm9yRWFjaCgocGFyYW0pID0+IHtcbiAgICAgICAgc3dpdGNoIChrZXkudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICAgIGNhc2UgJ3VpZCc6XG4gICAgICAgICAgICBwYXJhbSA9IHtcbiAgICAgICAgICAgICAgdHlwZTogJ3NlcXVlbmNlJyxcbiAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIC8vIFRoZSBHbWFpbCBleHRlbnNpb24gdmFsdWVzIG9mIFgtR00tVEhSSUQgYW5kXG4gICAgICAgICAgLy8gWC1HTS1NU0dJRCBhcmUgZGVmaW5lZCB0byBiZSB1bnNpZ25lZCA2NC1iaXQgaW50ZWdlcnNcbiAgICAgICAgICAvLyBhbmQgdGhleSBtdXN0IG5vdCBiZSBxdW90ZWQgc3RyaW5ncyBvciB0aGUgc2VydmVyXG4gICAgICAgICAgLy8gd2lsbCByZXBvcnQgYSBwYXJzZSBlcnJvci5cbiAgICAgICAgICBjYXNlICd4LWdtLXRocmlkJzpcbiAgICAgICAgICBjYXNlICd4LWdtLW1zZ2lkJzpcbiAgICAgICAgICAgIHBhcmFtID0ge1xuICAgICAgICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBwYXJhbSA9IGVzY2FwZVBhcmFtKHBhcmFtKVxuICAgICAgICB9XG4gICAgICAgIGlmIChwYXJhbSkge1xuICAgICAgICAgIHBhcmFtcyA9IHBhcmFtcy5jb25jYXQocGFyYW0gfHwgW10pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICBsaXN0ID0gbGlzdC5jb25jYXQocGFyYW1zIHx8IFtdKVxuICAgIH0pXG5cbiAgICByZXR1cm4gbGlzdFxuICB9XG5cbiAgY29tbWFuZC5hdHRyaWJ1dGVzID0gYnVpbGRUZXJtKHF1ZXJ5KVxuXG4gIC8vIElmIGFueSBzdHJpbmcgaW5wdXQgaXMgdXNpbmcgOGJpdCBieXRlcywgcHJlcGVuZCB0aGUgb3B0aW9uYWwgQ0hBUlNFVCBhcmd1bWVudFxuICBpZiAoIWlzQXNjaWkpIHtcbiAgICBjb21tYW5kLmF0dHJpYnV0ZXMudW5zaGlmdCh7XG4gICAgICB0eXBlOiAnYXRvbScsXG4gICAgICB2YWx1ZTogJ1VURi04J1xuICAgIH0pXG4gICAgY29tbWFuZC5hdHRyaWJ1dGVzLnVuc2hpZnQoe1xuICAgICAgdHlwZTogJ2F0b20nLFxuICAgICAgdmFsdWU6ICdDSEFSU0VUJ1xuICAgIH0pXG4gIH1cblxuICByZXR1cm4gY29tbWFuZFxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gSU1BUCBTVE9SRSBjb21tYW5kIGZyb20gdGhlIHNlbGVjdGVkIGFyZ3VtZW50c1xuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTVE9SRUNvbW1hbmQgKHNlcXVlbmNlLCBhY3Rpb24gPSAnJywgZmxhZ3MgPSBbXSwgb3B0aW9ucyA9IHt9KSB7XG4gIGNvbnN0IGNvbW1hbmQgPSB7XG4gICAgY29tbWFuZDogb3B0aW9ucy5ieVVpZCA/ICdVSUQgU1RPUkUnIDogJ1NUT1JFJyxcbiAgICBhdHRyaWJ1dGVzOiBbe1xuICAgICAgdHlwZTogJ3NlcXVlbmNlJyxcbiAgICAgIHZhbHVlOiBzZXF1ZW5jZVxuICAgIH1dXG4gIH1cblxuICBjb21tYW5kLmF0dHJpYnV0ZXMucHVzaCh7XG4gICAgdHlwZTogJ2F0b20nLFxuICAgIHZhbHVlOiBhY3Rpb24udG9VcHBlckNhc2UoKSArIChvcHRpb25zLnNpbGVudCA/ICcuU0lMRU5UJyA6ICcnKVxuICB9KVxuXG4gIGNvbW1hbmQuYXR0cmlidXRlcy5wdXNoKGZsYWdzLm1hcCgoZmxhZykgPT4ge1xuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiAnYXRvbScsXG4gICAgICB2YWx1ZTogZmxhZ1xuICAgIH1cbiAgfSkpXG5cbiAgcmV0dXJuIGNvbW1hbmRcbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsSUFBQUEsbUJBQUEsR0FBQUMsT0FBQTtBQUNBLElBQUFDLGlCQUFBLEdBQUFELE9BQUE7QUFDQSxJQUFBRSxZQUFBLEdBQUFGLE9BQUE7QUFDQSxJQUFBRyxPQUFBLEdBQUFILE9BQUE7QUFLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ08sU0FBU0ksaUJBQWlCQSxDQUFFQyxRQUFRLEVBQUVDLEtBQUssRUFBRUMsT0FBTyxFQUFFO0VBQzNELE1BQU1DLE9BQU8sR0FBRztJQUNkQSxPQUFPLEVBQUVELE9BQU8sQ0FBQ0UsS0FBSyxHQUFHLFdBQVcsR0FBRyxPQUFPO0lBQzlDQyxVQUFVLEVBQUUsQ0FBQztNQUNYQyxJQUFJLEVBQUUsVUFBVTtNQUNoQkMsS0FBSyxFQUFFUDtJQUNULENBQUM7RUFDSCxDQUFDO0VBRUQsSUFBSUUsT0FBTyxDQUFDTSxhQUFhLEtBQUtDLFNBQVMsRUFBRTtJQUN2Q04sT0FBTyxDQUFDSyxhQUFhLEdBQUdOLE9BQU8sQ0FBQ00sYUFBYTtFQUMvQztFQUVBLElBQUlFLEtBQUssR0FBRyxFQUFFO0VBRWRULEtBQUssQ0FBQ1UsT0FBTyxDQUFFQyxJQUFJLElBQUs7SUFDdEJBLElBQUksR0FBR0EsSUFBSSxDQUFDQyxXQUFXLEVBQUUsQ0FBQ0MsSUFBSSxFQUFFO0lBRWhDLElBQUksT0FBTyxDQUFDQyxJQUFJLENBQUNILElBQUksQ0FBQyxFQUFFO01BQ3RCO01BQ0FGLEtBQUssQ0FBQ00sSUFBSSxDQUFDO1FBQ1RWLElBQUksRUFBRSxNQUFNO1FBQ1pDLEtBQUssRUFBRUs7TUFDVCxDQUFDLENBQUM7SUFDSixDQUFDLE1BQU0sSUFBSUEsSUFBSSxFQUFFO01BQ2YsSUFBSTtR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