"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.TIMEOUT_NOOP = exports.TIMEOUT_IDLE = exports.TIMEOUT_CONNECTION = exports.STATE_SELECTED = exports.STATE_NOT_AUTHENTICATED = exports.STATE_LOGOUT = exports.STATE_CONNECTING = exports.STATE_AUTHENTICATED = exports.DEFAULT_CLIENT_ID = void 0;
var _ramda = require("ramda");
var _emailjsUtf = require("emailjs-utf7");
var _commandParser = require("./command-parser");
var _commandBuilder = require("./command-builder");
var _logger = _interopRequireDefault(require("./logger"));
var _imap = _interopRequireDefault(require("./imap"));
var _common = require("./common");
var _specialUse = require("./special-use");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }
function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }
const TIMEOUT_CONNECTION = exports.TIMEOUT_CONNECTION = 90 * 1000; // Milliseconds to wait for the IMAP greeting from the server
const TIMEOUT_NOOP = exports.TIMEOUT_NOOP = 60 * 1000; // Milliseconds between NOOP commands while idling
const TIMEOUT_IDLE = exports.TIMEOUT_IDLE = 60 * 1000; // Milliseconds until IDLE command is cancelled

const STATE_CONNECTING = exports.STATE_CONNECTING = 1;
const STATE_NOT_AUTHENTICATED = exports.STATE_NOT_AUTHENTICATED = 2;
const STATE_AUTHENTICATED = exports.STATE_AUTHENTICATED = 3;
const STATE_SELECTED = exports.STATE_SELECTED = 4;
const STATE_LOGOUT = exports.STATE_LOGOUT = 5;
const DEFAULT_CLIENT_ID = exports.DEFAULT_CLIENT_ID = {
  name: 'emailjs-imap-client'
};

/**
 * emailjs IMAP client
 *
 * @constructor
 *
 * @param {String} [host='localhost'] Hostname to conenct to
 * @param {Number} [port=143] Port number to connect to
 * @param {Object} [options] Optional options object
 */
class Client {
  constructor(host, port, options = {}) {
    this.timeoutConnection = TIMEOUT_CONNECTION;
    this.timeoutNoop = TIMEOUT_NOOP;
    this.timeoutIdle = TIMEOUT_IDLE;
    this.serverId = false; // RFC 2971 Server ID as key value pairs

    // Event placeholders
    this.oncert = null;
    this.onupdate = null;
    this.onselectmailbox = null;
    this.onclosemailbox = null;
    this._host = host;
    this._clientId = (0, _ramda.propOr)(DEFAULT_CLIENT_ID, 'id', options);
    this._state = false; // Current state
    this._authenticated = false; // Is the connection authenticated
    this._capability = []; // List of extensions the server supports
    this._selectedMailbox = false; // Selected mailbox
    this._enteredIdle = false;
    this._idleTimeout = false;
    this._enableCompression = !!options.enableCompression;
    this._auth = options.auth;
    this._requireTLS = !!options.requireTLS;
    this._ignoreTLS = !!options.ignoreTLS;
    this.client = new _imap.default(host, port, options); // IMAP client object

    // Event Handlers
    this.client.onerror = this._onError.bind(this);
    this.client.oncert = cert => this.oncert && this.oncert(cert); // allows certificate handling for platforms w/o native tls support
    this.client.onidle = () => this._onIdle(); // start idling

    // Default handlers for untagged responses
    this.client.setHandler('capability', response => this._untaggedCapabilityHandler(response)); // capability updates
    this.client.setHandler('ok', response => this._untaggedOkHandler(response)); // notifications
    this.client.setHandler('exists', response => this._untaggedExistsHandler(response)); // message count has changed
    this.client.setHandler('expunge', response => this._untaggedExpungeHandler(response)); // message has been deleted
    this.client.setHandler('fetch', response => this._untaggedFetchHandler(response)); // message has been updated (eg. flag change)

    // Activate logging
    this.createLogger();
    this.logLevel = (0, _ramda.propOr)(_common.LOG_LEVEL_ALL, 'logLevel', options);
  }

  /**
   * Called if the lower-level ImapClient has encountered an unrecoverable
   * error during operation. Cleans up and propagates the error upwards.
   */
  _onError(err) {
    // make sure no idle timeout is pending anymore
    clearTimeout(this._idleTimeout);

    // propagate the error upwards
    this.onerror && this.onerror(err);
  }

  //
  //
  // PUBLIC API
  //
  //

  /**
   * Initiate connection and login to the IMAP server
   *
   * @returns {Promise} Promise when login procedure is complete
   */
  connect() {
    var _this = this;
    return _asyncToGenerator(function* () {
      try {
        yield _this.openConnection();
        yield _this.upgradeConnection();
        try {
          yield _this.updateId(_this._clientId);
        } catch (err) {
          _this.logger.warn('Failed to update server id!', err.message);
        }
        yield _this.login(_this._auth);
        yield _this.compressConnection();
        _this.logger.debug('Connection established, ready to roll!');
        _this.client.onerror = _this._onError.bind(_this);
      } catch (err) {
        _this.logger.error('Could not connect to server', err);
        _this.close(err); // we don't really care whether this works or not
        throw err;
      }
    })();
  }

  /**
   * Initiate connection to the IMAP server
   *
   * @returns {Promise} capability of server without login
   */
  openConnection() {
    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => reject(new Error('Timeout connecting to server')), this.timeoutConnection);
      this.logger.debug('Connecting to', this.client.host, ':', this.client.port);
      this._changeState(STATE_CONNECTING);
      this.client.connect().then(() => {
        this.logger.debug('Socket opened, waiting for greeting from the server...');
        this.client.onready = () => {
          clearTimeout(connectionTimeout);
          this._changeState(STATE_NOT_AUTHENTICATED);
          this.updateCapability().then(() => resolve(this._capability));
        };
        this.client.onerror = err => {
          clearTimeout(connectionTimeout);
          reject(err);
        };
      }).catch(reject);
    });
  }

  /**
   * Logout
   *
   * Send LOGOUT, to which the server responds by closing the connection.
   * Use is discouraged if network status is unclear! If networks status is
   * unclear, please use #close instead!
   *
   * LOGOUT details:
   *   https://tools.ietf.org/html/rfc3501#section-6.1.3
   *
   * @returns {Promise} Resolves when server has closed the connection
   */
  logout() {
    var _this2 = this;
    return _asyncToGenerator(function* () {
      _this2._changeState(STATE_LOGOUT);
      _this2.logger.debug('Logging out...');
      yield _this2.client.logout();
      clearTimeout(_this2._idleTimeout);
    })();
  }

  /**
   * Force-closes the current connection by closing the TCP socket.
   *
   * @returns {Promise} Resolves when socket is closed
   */
  close(err) {
    var _this3 = this;
    return _asyncToGenerator(function* () {
      _this3._changeState(STATE_LOGOUT);
      clearTimeout(_this3._idleTimeout);
      _this3.logger.debug('Closing connection...');
      yield _this3.client.close(err);
      clearTimeout(_this3._idleTimeout);
    })();
  }

  /**
   * Runs ID command, parses ID response, sets this.serverId
   *
   * ID details:
   *   http://tools.ietf.org/html/rfc2971
   *
   * @param {Object} id ID as JSON object. See http://tools.ietf.org/html/rfc2971#section-3.3 for possible values
   * @returns {Promise} Resolves when response has been parsed
   */
  updateId(id) {
    var _this4 = this;
    return _asyncToGenerator(function* () {
      if (_this4._capability.indexOf('ID') < 0) return;
      _this4.logger.debug('Updating id...');
      const command = 'ID';
      const attributes = id ? [(0, _ramda.flatten)(Object.entries(id))] : [null];
      const response = yield _this4.exec({
        command,
        attributes
      }, 'ID');
      const list = (0, _ramda.flatten)((0, _ramda.pathOr)([], ['payload', 'ID', '0', 'attributes', '0'], response).map(Object.values));
      const keys = list.filter((_, i) => i % 2 === 0);
      const values = list.filter((_, i) => i % 2 === 1);
      _this4.serverId = (0, _ramda.fromPairs)((0, _ramda.zip)(keys, values));
      _this4.logger.debug('Server id updated!', _this4.serverId);
    })();
  }
  _shouldSelectMailbox(path, ctx) {
    if (!ctx) {
      return true;
    }
    const previousSelect = this.client.getPreviouslyQueued(['SELECT', 'EXAMINE'], ctx);
    if (previousSelect && previousSelect.request.attributes) {
      const pathAttribute = previousSelect.request.attributes.find(attribute => attribute.type === 'STRING');
      if (pathAttribute) {
        return pathAttribute.value !== path;
      }
    }
    return this._selectedMailbox !== path;
  }

  /**
   * Runs SELECT or EXAMINE to open a mailbox
   *
   * SELECT details:
   *   http://tools.ietf.org/html/rfc3501#section-6.3.1
   * EXAMINE details:
   *   http://tools.ietf.org/html/rfc3501#section-6.3.2
   *
   * @param {String} path Full path to mailbox
   * @param {Object} [options] Options object
   * @returns {Promise} Promise with information about the selected mailbox
   */
  selectMailbox(path, options = {}) {
    var _this5 = this;
    return _asyncToGenerator(function* () {
      const query = {
        command: options.readOnly ? 'EXAMINE' : 'SELECT',
        attributes: [{
          type: 'STRING',
          value: path
        }]
      };
      if (options.condstore && _this5._capability.indexOf('CONDSTORE') >= 0) {
        query.attributes.push([{
          type: 'ATOM',
          value: 'CONDSTORE'
        }]);
      }
      _this5.logger.debug('Opening', path, '...');
      const response = yield _this5.exec(query, ['EXISTS', 'FLAGS', 'OK'], {
        ctx: options.ctx
      });
      const mailboxInfo = (0, _commandParser.parseSELECT)(response);
      _this5._changeState(STATE_SELECTED);
      if (_this5._selectedMailbox !== path && _this5.onclosemailbox) {
        yield _this5.onclosemailbox(_this5._selectedMailbox);
      }
      _this5._selectedMailbox = path;
      if (_this5.onselectmailbox) {
        yield _this5.onselectmailbox(path, mailboxInfo);
      }
      return mailboxInfo;
    })();
  }

  /**
   * Runs NAMESPACE command
   *
   * NAMESPACE details:
   *   https://tools.ietf.org/html/rfc2342
   *
   * @returns {Promise} Promise with namespace object
   */
  listNamespaces() {
    var _this6 = this;
    return _asyncToGenerator(function* () {
      if (_this6._capability.indexOf('NAMESPACE') < 0) return false;
      _this6.logger.debug('Listing namespaces...');
      const response = yield _this6.exec('NAMESPACE', 'NAMESPACE');
      return (0, _commandParser.parseNAMESPACE)(response);
    })();
  }

  /**
   * Runs LIST and LSUB commands. Retrieves a tree of available mailboxes
   *
   * LIST details:
   *   http://tools.ietf.org/html/rfc3501#section-6.3.8
   * LSUB details:
   *   http://tools.ietf.org/html/rfc3501#section-6.3.9
   *
   * @returns {Promise} Promise with list of mailboxes
   */
  listMailboxes() {
    var _this7 = this;
    return _asyncToGenerator(function* () {
      const tree = {
        root: true,
        children: []
      };
      _this7.logger.debug('Listing mailboxes...');
      const listResponse = yield _this7.exec({
        command: 'LIST',
        attributes: ['', '*']
      }, 'LIST');
      const list = (0, _ramda.pathOr)([], ['payload', 'LIST'], listResponse);
      list.forEach(item => {
        const attr = (0, _ramda.propOr)([], 'attributes', item);
        if (attr.length < 3) return;
        const path = (0, _ramda.pathOr)('', ['2', 'value'], attr);
        const delim = (0, _ramda.pathOr)('/', ['1', 'value'], attr);
        const branch = _this7._ensurePath(tree, path, delim);
        branch.flags = (0, _ramda.propOr)([], '0', attr).map(({
          value
        }) => value || '');
        branch.listed = true;
        (0, _specialUse.checkSpecialUse)(branch);
      });
      const lsubResponse = yield _this7.exec({
        command: 'LSUB',
        attributes: ['', '*']
      }, 'LSUB');
      const lsub = (0, _ramda.pathOr)([], ['payload', 'LSUB'], lsubResponse);
      lsub.forEach(item => {
        const attr = (0, _ramda.propOr)([], 'attributes', item);
        if (attr.length < 3) return;
        const path = (0, _ramda.pathOr)('', ['2', 'value'], attr);
        const delim = (0, _ramda.pathOr)('/', ['1', 'value'], attr);
        const branch = _this7._ensurePath(tree, path, delim);
        (0, _ramda.propOr)([], '0', attr).map((flag = '') => {
          branch.flags = (0, _ramda.union)(branch.flags, [flag]);
        });
        branch.subscribed = true;
      });
      return tree;
    })();
  }

  /**
   * Runs mailbox STATUS
   *
   * STATUS details:
   *  https://tools.ietf.org/html/rfc3501#section-6.3.10
   *
   * @param {String} path Full path to mailbox
   * @param {Object} [options] Options object
   * @returns {Promise} Promise with information about the selected mailbox
   */
  mailboxStatus(path, options = {}) {
    var _this8 = this;
    return _asyncToGenerator(function* () {
      const statusDataItems = ['UIDNEXT', 'MESSAGES'];
      if (options.condstore && _this8._capability.indexOf('CONDSTORE') >= 0) {
        statusDataItems.push('HIGHESTMODSEQ');
      }
      const statusAttributes = statusDataItems.map(statusDataItem => {
        return {
          type: 'ATOM',
          value: statusDataItem
        };
      });
      _this8.logger.debug('Opening', path, '...');
      const response = yield _this8.exec({
        command: 'STATUS',
        attributes: [{
          type: 'STRING',
          value: path
        }, [...statusAttributes]]
      }, ['STATUS']);
      return (0, _commandParser.parseSTATUS)(response, statusDataItems);
    })();
  }

  /**
   * Create a mailbox with the given path.
   *
   * CREATE details:
   *   http://tools.ietf.org/html/rfc3501#section-6.3.3
   *
   * @param {String} path
   *     The path of the mailbox you would like to create.  This method will
   *     handle utf7 encoding for you.
   * @returns {Promise}
   *     Promise resolves if mailbox was created.
   *     In the event the server says NO [ALREADYEXISTS], we treat that as success.
   */
  createMailbox(path) {
    var _this9 = this;
    return _asyncToGenerator(function* () {
      _this9.logger.debug('Creating mailbox', path, '...');
      try {
        yield _this9.exec({
          command: 'CREATE',
          attributes: [(0, _emailjsUtf.imapEncode)(path)]
        });
      } catch (err) {
        if (err && err.code === 'ALREADYEXISTS') {
          return;
        }
        throw err;
      }
    })();
  }

  /**
   * Delete a mailbox with the given path.
   *
   * DELETE details:
   *   https://tools.ietf.org/html/rfc3501#section-6.3.4
   *
   * @param {String} path
   *     The path of the mailbox you would like to delete.  This method will
   *     handle utf7 encoding for you.
   * @returns {Promise}
   *     Promise resolves if mailbox was deleted.
   */
  deleteMailbox(path) {
    this.logger.debug('Deleting mailbox', path, '...');
    return this.exec({
      command: 'DELETE',
      attributes: [(0, _emailjsUtf.imapEncode)(path)]
    });
  }

  /**
   * Runs FETCH command
   *
   * FETCH details:
   *   http://tools.ietf.org/html/rfc3501#section-6.4.5
   * CHANGEDSINCE details:
   *   https://tools.ietf.org/html/rfc4551#section-3.3
   *
   * @param {String} path The path for the mailbox which should be selected for the command. Selects mailbox if necessary
   * @param {String} sequence Sequence set, eg 1:* for all messages
   * @param {Object} [items] Message data item names or macro
   * @param {Object} [options] Query modifiers
   * @returns {Promise} Promise with the fetched message info
   */
  listMessages(path, sequence, items = [{
    fast: true
  }], options = {}) {
    var _this10 = this;
    return _asyncToGenerator(function* () {
      _this10.logger.debug('Fetching messages', sequence, 'from', path, '...');
      const command = (0, _commandBuilder.buildFETCHCommand)(sequence, items, options);
      const response = yield _this10.exec(command, 'FETCH', {
        precheck: ctx => _this10._shouldSelectMailbox(path, ctx) ? _this10.selectMailbox(path, {
          ctx
        }) : Promise.resolve()
      });
      return (0, _commandParser.parseFETCH)(response);
    })();
  }

  /**
   * Runs SEARCH command
   *
   * SEARCH details:
   *   http://tools.ietf.org/html/rfc3501#section-6.4.4
   *
   * @param {String} path The path for the mailbox which should be selected for the command. Selects mailbox if necessary
   * @param {Object} query Search terms
   * @param {Object} [options] Query modifiers
   * @returns {Promise} Promise with the array of matching seq. or uid numbers
   */
  search(path, query, options = {}) {
    var _this11 = this;
    return _asyncToGenerator(function* () {
      _this11.logger.debug('Searching in', path, '...');
      const command = (0, _commandBuilder.buildSEARCHCommand)(query, options);
      const response = yield _this11.exec(command, 'SEARCH', {
        precheck: ctx => _this11._shouldSelectMailbox(path, ctx) ? _this11.selectMailbox(path, {
          ctx
        }) : Promise.resolve()
      });
      return (0, _commandParser.parseSEARCH)(response);
    })();
  }

  /**
   * Runs STORE command
   *
   * STORE details:
   *   http://tools.ietf.org/html/rfc3501#section-6.4.6
   *
   * @param {String} path The path for the mailbox which should be selected for the command. Selects mailbox if necessary
   * @param {String} sequence Message selector which the flag change is applied to
   * @param {Array} flags
   * @param {Object} [options] Query modifiers
   * @returns {Promise} Promise with the array of matching seq. or uid numbers
   */
  setFlags(path, sequence, flags, options) {
    let key = '';
    let list = [];
    if (Array.isArray(flags) || typeof flags !== 'object') {
      list = [].concat(flags || []);
      key = '';
    } else if (flags.add) {
      list = [].concat(flags.add || []);
      key = '+';
    } else if (flags.set) {
      key = '';
      list = [].concat(flags.set || []);
    } else if (flags.remove) {
      key = '-';
      list = [].concat(flags.remove || []);
    }
    this.logger.debug('Setting flags on', sequence, 'in', path, '...');
    return this.store(path, sequence, key + 'FLAGS', list, options);
  }

  /**
   * Runs STORE command
   *
   * STORE details:
   *   http://tools.ietf.org/html/rfc3501#section-6.4.6
   *
   * @param {String} path The path for the mailbox which should be selected for the command. Selects mailbox if necessary
   * @param {String} sequence Message selector which the flag change is applied to
   * @param {String} action STORE method to call, eg "+FLAGS"
   * @param {Array} flags
   * @param {Object} [options] Query modifiers
   * @returns {Promise} Promise with the array of matching seq. or uid numbers
   */
  store(path, sequence, action, flags, options = {}) {
    var _this12 = this;
    return _asyncToGenerator(function* () {
      const command = (0, _commandBuilder.buildSTORECommand)(sequence, action, flags, options);
      const response = yield _this12.exec(command, 'FETCH', {
        precheck: ctx => _this12._shouldSelectMailbox(path, ctx) ? _this12.selectMailbox(path, {
          ctx
        }) : Promise.resolve()
      });
      return (0, _commandParser.parseFETCH)(response);
    })();
  }

  /**
   * Runs APPEND command
   *
   * APPEND details:
   *   http://tools.ietf.org/html/rfc3501#section-6.3.11
   *
   * @param {String} destination The mailbox where to append the message
   * @param {String} message The message to append
   * @param {Array} options.flags Any flags you want to set on the uploaded message. Defaults to [\Seen]. (optional)
   * @returns {Promise} Promise with the array of matching seq. or uid numbers
   */
  upload(destination, message, options = {}) {
    var _this13 = this;
    return _asyncToGenerator(function* () {
      const flags = (0, _ramda.propOr)(['\\Seen'], 'flags', options).map(value => ({
        type: 'atom',
        value
      }));
      const command = {
        command: 'APPEND',
        attributes: [{
          type: 'atom',
          value: destination
        }, flags, {
          type: 'literal',
          value: message
        }]
      };
      _this13.logger.debug('Uploading message to', destination, '...');
      const response = yield _this13.exec(command);
      return (0, _commandParser.parseAPPEND)(response);
    })();
  }

  /**
   * Deletes messages from a selected mailbox
   *
   * EXPUNGE details:
   *   http://tools.ietf.org/html/rfc3501#section-6.4.3
   * UID EXPUNGE details:
   *   https://tools.ietf.org/html/rfc4315#section-2.1
   *
   * If possible (byUid:true and UIDPLUS extension supported), uses UID EXPUNGE
   * command to delete a range of messages, otherwise falls back to EXPUNGE.
   *
   * NB! This method might be destructive - if EXPUNGE is used, then any messages
   * with \Deleted flag set are deleted
   *
   * @param {String} path The path for the mailbox which should be selected for the command. Selects mailbox if necessary
   * @param {String} sequence Message range to be deleted
   * @param {Object} [options] Query modifiers
   * @returns {Promise} Promise
   */
  deleteMessages(path, sequence, options = {}) {
    var _this14 = this;
    return _asyncToGenerator(function* () {
      // add \Deleted flag to the messages and run EXPUNGE or UID EXPUNGE
      _this14.logger.debug('Deleting messages', sequence, 'in', path, '...');
      const useUidPlus = options.byUid && _this14._capability.indexOf('UIDPLUS') >= 0;
      const uidExpungeCommand = {
        command: 'UID EXPUNGE',
        attributes: [{
          type: 'sequence',
          value: sequence
        }]
      };
      yield _this14.setFlags(path, sequence, {
        add: '\\Deleted'
      }, options);
      const cmd = useUidPlus ? uidExpungeCommand : 'EXPUNGE';
      return _this14.exec(cmd, null, {
        precheck: ctx => _this14._shouldSelectMailbox(path, ctx) ? _this14.selectMailbox(path, {
          ctx
        }) : Promise.resolve()
      });
    })();
  }

  /**
   * Copies a range of messages from the active mailbox to the destination mailbox.
   * Silent method (unless an error occurs), by default returns no information.
   *
   * COPY details:
   *   http://tools.ietf.org/html/rfc3501#section-6.4.7
   *
   * @param {String} path The path for the mailbox which should be selected for the command. Selects mailbox if necessary
   * @param {String} sequence Message range to be copied
   * @param {String} destination Destination mailbox path
   * @param {Object} [options] Query modifiers
   * @param {Boolean} [options.byUid] If true, uses UID COPY instead of COPY
   * @returns {Promise} Promise
   */
  copyMessages(path, sequence, destination, options = {}) {
    var _this15 = this;
    return _asyncToGenerator(function* () {
      _this15.logger.debug('Copying messages', sequence, 'from', path, 'to', destination, '...');
      const response = yield _this15.exec({
        command: options.byUid ? 'UID COPY' : 'COPY',
        attributes: [{
          type: 'sequence',
          value: sequence
        }, {
          type: 'atom',
          value: destination
        }]
      }, null, {
        precheck: ctx => _this15._shouldSelectMailbox(path, ctx) ? _this15.selectMailbox(path, {
          ctx
        }) : Promise.resolve()
      });
      return (0, _commandParser.parseCOPY)(response);
    })();
  }

  /**
   * Moves a range of messages from the active mailbox to the destination mailbox.
   * Prefers the MOVE extension but if not available, falls back to
   * COPY + EXPUNGE
   *
   * MOVE details:
   *   http://tools.ietf.org/html/rfc6851
   *
   * @param {String} path The path for the mailbox which should be selected for the command. Selects mailbox if necessary
   * @param {String} sequence Message range to be moved
   * @param {String} destination Destination mailbox path
   * @param {Object} [options] Query modifiers
   * @returns {Promise} Promise
   */
  moveMessages(path, sequence, destination, options = {}) {
    var _this16 = this;
    return _asyncToGenerator(function* () {
      _this16.logger.debug('Moving messages', sequence, 'from', path, 'to', destination, '...');
      if (_this16._capability.indexOf('MOVE') === -1) {
        // Fallback to COPY + EXPUNGE
        yield _this16.copyMessages(path, sequence, destination, options);
        return _this16.deleteMessages(path, sequence, options);
      }

      // If possible, use MOVE
      return _this16.exec({
        command: options.byUid ? 'UID MOVE' : 'MOVE',
        attributes: [{
          type: 'sequence',
          value: sequence
        }, {
          type: 'atom',
          value: destination
        }]
      }, ['OK'], {
        precheck: ctx => _this16._shouldSelectMailbox(path, ctx) ? _this16.selectMailbox(path, {
          ctx
        }) : Promise.resolve()
      });
    })();
  }

  /**
   * Runs COMPRESS command
   *
   * COMPRESS details:
   *   https://tools.ietf.org/html/rfc4978
   */
  compressConnection() {
    var _this17 = this;
    return _asyncToGenerator(function* () {
      if (!_this17._enableCompression || _this17._capability.indexOf('COMPRESS=DEFLATE') < 0 || _this17.client.compressed) {
        return false;
      }
      _this17.logger.debug('Enabling compression...');
      yield _this17.exec({
        command: 'COMPRESS',
        attributes: [{
          type: 'ATOM',
          value: 'DEFLATE'
        }]
      });
      _this17.client.enableCompression();
      _this17.logger.debug('Compression enabled, all data sent and received is deflated!');
    })();
  }

  /**
   * Runs LOGIN or AUTHENTICATE XOAUTH2 command
   *
   * LOGIN details:
   *   http://tools.ietf.org/html/rfc3501#section-6.2.3
   * XOAUTH2 details:
   *   https://developers.google.com/gmail/xoauth2_protocol#imap_protocol_exchange
   *
   * @param {String} auth.user
   * @param {String} auth.pass
   * @param {String} auth.xoauth2
   */
  login(auth) {
    var _this18 = this;
    return _asyncToGenerator(function* () {
      let command;
      const options = {};
      if (!auth) {
        throw new Error('Authentication information not provided');
      }
      if (_this18._capability.indexOf('AUTH=XOAUTH2') >= 0 && auth && auth.xoauth2) {
        command = {
          command: 'AUTHENTICATE',
          attributes: [{
            type: 'ATOM',
            value: 'XOAUTH2'
          }, {
            type: 'ATOM',
            value: (0, _commandBuilder.buildXOAuth2Token)(auth.user, auth.xoauth2),
            sensitive: true
          }]
        };
        options.errorResponseExpectsEmptyLine = true; // + tagged error response expects an empty line in return
      } else {
        command = {
          command: 'login',
          attributes: [{
            type: 'STRING',
            value: auth.user || ''
          }, {
            type: 'STRING',
            value: auth.pass || '',
            sensitive: true
          }]
        };
      }
      _this18.logger.debug('Logging in...');
      const response = yield _this18.exec(command, 'capability', options);
      /*
       * update post-auth capabilites
       * capability list shouldn't contain auth related stuff anymore
       * but some new extensions might have popped up that do not
       * make much sense in the non-auth state
       */
      if (response.capability && response.capability.length) {
        // capabilites were listed with the OK [CAPABILITY ...] response
        _this18._capability = response.capability;
      } else if (response.payload && response.payload.CAPABILITY && response.payload.CAPABILITY.length) {
        // capabilites were listed with * CAPABILITY ... response
        _this18._capability = response.payload.CAPABILITY.pop().attributes.map((capa = '') => capa.value.toUpperCase().trim());
      } else {
        // capabilities were not automatically listed, reload
        yield _this18.updateCapability(true);
      }
      _this18._changeState(STATE_AUTHENTICATED);
      _this18._authenticated = true;
      _this18.logger.debug('Login successful, post-auth capabilites updated!', _this18._capability);
    })();
  }

  /**
   * Run an IMAP command.
   *
   * @param {Object} request Structured request object
   * @param {Array} acceptUntagged a list of untagged responses that will be included in 'payload' property
   */
  exec(request, acceptUntagged, options) {
    var _this19 = this;
    return _asyncToGenerator(function* () {
      _this19.breakIdle();
      const response = yield _this19.client.enqueueCommand(request, acceptUntagged, options);
      if (response && response.capability) {
        _this19._capability = response.capability;
      }
      return response;
    })();
  }

  /**
   * The connection is idling. Sends a NOOP or IDLE command
   *
   * IDLE details:
   *   https://tools.ietf.org/html/rfc2177
   */
  enterIdle() {
    if (this._enteredIdle) {
      return;
    }
    const supportsIdle = this._capability.indexOf('IDLE') >= 0;
    this._enteredIdle = supportsIdle && this._selectedMailbox ? 'IDLE' : 'NOOP';
    this.logger.debug('Entering idle with ' + this._enteredIdle);
    if (this._enteredIdle === 'NOOP') {
      this._idleTimeout = setTimeout(() => {
        this.logger.debug('Sending NOOP');
        this.exec('NOOP');
      }, this.timeoutNoop);
    } else if (this._enteredIdle === 'IDLE') {
      this.client.enqueueCommand({
        command: 'IDLE'
      });
      this._idleTimeout = setTimeout(() => {
        this.client.send('DONE\r\n');
        this._enteredIdle = false;
        this.logger.debug('Idle terminated');
      }, this.timeoutIdle);
    }
  }

  /**
   * Stops actions related idling, if IDLE is supported, sends DONE to stop it
   */
  breakIdle() {
    if (!this._enteredIdle) {
      return;
    }
    clearTimeout(this._idleTimeout);
    if (this._enteredIdle === 'IDLE') {
      this.client.send('DONE\r\n');
      this.logger.debug('Idle terminated');
    }
    this._enteredIdle = false;
  }

  /**
   * Runs STARTTLS command if needed
   *
   * STARTTLS details:
   *   http://tools.ietf.org/html/rfc3501#section-6.2.1
   *
   * @param {Boolean} [forced] By default the command is not run if capability is already listed. Set to true to skip this validation
   */
  upgradeConnection() {
    var _this20 = this;
    return _asyncToGenerator(function* () {
      // skip request, if already secured
      if (_this20.client.secureMode) {
        return false;
      }

      // skip if STARTTLS not available or starttls support disabled
      if ((_this20._capability.indexOf('STARTTLS') < 0 || _this20._ignoreTLS) && !_this20._requireTLS) {
        return false;
      }
      _this20.logger.debug('Encrypting connection...');
      yield _this20.exec('STARTTLS');
      _this20._capability = [];
      _this20.client.upgrade();
      return _this20.updateCapability();
    })();
  }

  /**
   * Runs CAPABILITY command
   *
   * CAPABILITY details:
   *   http://tools.ietf.org/html/rfc3501#section-6.1.1
   *
   * Doesn't register untagged CAPABILITY handler as this is already
   * handled by global handler
   *
   * @param {Boolean} [forced] By default the command is not run if capability is already listed. Set to true to skip this validation
   */
  updateCapability(forced) {
    var _this21 = this;
    return _asyncToGenerator(function* () {
      // skip request, if not forced update and capabilities are already loaded
      if (!forced && _this21._capability.length) {
        return;
      }

      // If STARTTLS is required then skip capability listing as we are going to try
      // STARTTLS anyway and we re-check capabilities after connection is secured
      if (!_this21.client.secureMode && _this21._requireTLS) {
        return;
      }
      _this21.logger.debug('Updating capability...');
      return _this21.exec('CAPABILITY');
    })();
  }
  hasCapability(capa = '') {
    return this._capability.indexOf(capa.toUpperCase().trim()) >= 0;
  }

  // Default handlers for untagged responses

  /**
   * Checks if an untagged OK includes [CAPABILITY] tag and updates capability object
   *
   * @param {Object} response Parsed server response
   * @param {Function} next Until called, server responses are not processed
   */
  _untaggedOkHandler(response) {
    if (response && response.capability) {
      this._capability = response.capability;
    }
  }

  /**
   * Updates capability object
   *
   * @param {Object} response Parsed server response
   * @param {Function} next Until called, server responses are not processed
   */
  _untaggedCapabilityHandler(response) {
    this._capability = (0, _ramda.pipe)((0, _ramda.propOr)([], 'attributes'), (0, _ramda.map)(({
      value
    }) => (value || '').toUpperCase().trim()))(response);
  }

  /**
   * Updates existing message count
   *
   * @param {Object} response Parsed server response
   * @param {Function} next Until called, server responses are not processed
   */
  _untaggedExistsHandler(response) {
    if (response && Object.prototype.hasOwnProperty.call(response, 'nr')) {
      this.onupdate && this.onupdate(this._selectedMailbox, 'exists', response.nr);
    }
  }

  /**
   * Indicates a message has been deleted
   *
   * @param {Object} response Parsed server response
   * @param {Function} next Until called, server responses are not processed
   */
  _untaggedExpungeHandler(response) {
    if (response && Object.prototype.hasOwnProperty.call(response, 'nr')) {
      this.onupdate && this.onupdate(this._selectedMailbox, 'expunge', response.nr);
    }
  }

  /**
   * Indicates that flags have been updated for a message
   *
   * @param {Object} response Parsed server response
   * @param {Function} next Until called, server responses are not processed
   */
  _untaggedFetchHandler(response) {
    this.onupdate && this.onupdate(this._selectedMailbox, 'fetch', [].concat((0, _commandParser.parseFETCH)({
      payload: {
        FETCH: [response]
      }
    }) || []).shift());
  }

  // Private helpers

  /**
   * Indicates that the connection started idling. Initiates a cycle
   * of NOOPs or IDLEs to receive notifications about updates in the server
   */
  _onIdle() {
    if (!this._authenticated || this._enteredIdle) {
      // No need to IDLE when not logged in or already idling
      return;
    }
    this.logger.debug('Client started idling');
    this.enterIdle();
  }

  /**
   * Updates the IMAP state value for the current connection
   *
   * @param {Number} newState The state you want to change to
   */
  _changeState(newState) {
    if (newState === this._state) {
      return;
    }
    this.logger.debug('Entering state: ' + newState);

    // if a mailbox was opened, emit onclosemailbox and clear selectedMailbox value
    if (this._state === STATE_SELECTED && this._selectedMailbox) {
      this.onclosemailbox && this.onclosemailbox(this._selectedMailbox);
      this._selectedMailbox = false;
    }
    this._state = newState;
  }

  /**
   * Ensures a path exists in the Mailbox tree
   *
   * @param {Object} tree Mailbox tree
   * @param {String} path
   * @param {String} delimiter
   * @return {Object} branch for used path
   */
  _ensurePath(tree, path, delimiter) {
    const names = path.split(delimiter);
    let branch = tree;
    for (let i = 0; i < names.length; i++) {
      let found = false;
      for (let j = 0; j < branch.children.length; j++) {
        if (this._compareMailboxNames(branch.children[j].name, (0, _emailjsUtf.imapDecode)(names[i]))) {
          branch = branch.children[j];
          found = true;
          break;
        }
      }
      if (!found) {
        branch.children.push({
          name: (0, _emailjsUtf.imapDecode)(names[i]),
          delimiter: delimiter,
          path: names.slice(0, i + 1).join(delimiter),
          children: []
        });
        branch = branch.children[branch.children.length - 1];
      }
    }
    return branch;
  }

  /**
   * Compares two mailbox names. Case insensitive in case of INBOX, otherwise case sensitive
   *
   * @param {String} a Mailbox name
   * @param {String} b Mailbox name
   * @returns {Boolean} True if the folder names match
   */
  _compareMailboxNames(a, b) {
    return (a.toUpperCase() === 'INBOX' ? 'INBOX' : a) === (b.toUpperCase() === 'INBOX' ? 'INBOX' : b);
  }
  createLogger(creator = _logger.default) {
    const logger = creator((this._auth || {}).user || '', this._host);
    this.logger = this.client.logger = {
      debug: (...msgs) => {
        if (_common.LOG_LEVEL_DEBUG >= this.logLevel) {
          logger.debug(msgs);
        }
      },
      info: (...msgs) => {
        if (_common.LOG_LEVEL_INFO >= this.logLevel) {
          logger.info(msgs);
        }
      },
      warn: (...msgs) => {
        if (_common.LOG_LEVEL_WARN >= this.logLevel) {
          logger.warn(msgs);
        }
      },
      error: (...msgs) => {
        if (_common.LOG_LEVEL_ERROR >= this.logLevel) {
          logger.error(msgs);
        }
      }
    };
  }
}
exports.default = Client;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcmFtZGEiLCJyZXF1aXJlIiwiX2VtYWlsanNVdGYiLCJfY29tbWFuZFBhcnNlciIsIl9jb21tYW5kQnVpbGRlciIsIl9sb2dnZXIiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX2ltYXAiLCJfY29tbW9uIiwiX3NwZWNpYWxVc2UiLCJvYmoiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsImFzeW5jR2VuZXJhdG9yU3RlcCIsImdlbiIsInJlc29sdmUiLCJyZWplY3QiLCJfbmV4dCIsIl90aHJvdyIsImtleSIsImFyZyIsImluZm8iLCJ2YWx1ZSIsImVycm9yIiwiZG9uZSIsIlByb21pc2UiLCJ0aGVuIiwiX2FzeW5jVG9HZW5lcmF0b3IiLCJmbiIsInNlbGYiLCJhcmdzIiwiYXJndW1lbnRzIiwiYXBwbHkiLCJlcnIiLCJ1bmRlZmluZWQiLCJUSU1FT1VUX0NPTk5FQ1RJT04iLCJleHBvcnRzIiwiVElNRU9VVF9OT09QIiwiVElNRU9VVF9JRExFIiwiU1RBVEVfQ09OTkVDVElORyIsIlNUQVRFX05PVF9BVVRIRU5USUNBVEVEIiwiU1RBVEVfQVVUSEVOVElDQVRFRCIsIlNUQVRFX1NFTEVDVEVEIiwiU1RBVEVfTE9HT1VUIiwiREVGQVVMVF9DTElFTlRfSUQiLCJuYW1lIiwiQ2xpZW50IiwiY29uc3RydWN0b3IiLCJob3N0IiwicG9ydCIsIm9wdGlvbnMiLCJ0aW1lb3V0Q29ubmVjdGlvbiIsInRpbWVvdXROb29wIiwidGltZW91dElkbGUiLCJzZXJ2ZXJJZCIsIm9uY2VydCIsIm9udXBkYXRlIiwib25zZWxlY3RtYWlsYm94Iiwib25jbG9zZW1haWxib3giLCJfaG9zdCIsIl9jbGllbnRJZCIsInByb3BPciIsIl9zdGF0ZSIsIl9hdXRoZW50aWNhdGVkIiwiX2NhcGFiaWxpdHkiLCJfc2VsZWN0ZWRNYWlsYm94IiwiX2VudGVyZWRJZGxlIiwiX2lkbGVUaW1lb3V0IiwiX2VuYWJsZUNvbXByZXNzaW9uIiwiZW5hYmxlQ29tcHJlc3Npb24iLCJfYXV0aCIsImF1dGgiLCJfcmVxdWlyZVRMUyIsInJlcXVpcmVUTFMiLCJfaWdub3JlVExTIiwiaWdub3JlVExTIiwiY2xpZW50IiwiSW1hcENsaWVudCIsIm9uZXJyb3IiLCJfb25FcnJvciIsImJpbmQiLCJjZXJ0Iiwib25pZGxlIiwiX29uSWRsZSIsInNldEhhbmRsZXIiLCJyZXNwb25zZSIsIl91bnRhZ2dlZENhcGFiaWxpdHlIYW5kbGVyIiwiX3VudGFnZ2VkT2tIYW5kbGVyIiwiX3VudGFnZ2VkRXhpc3RzSGFuZGxlciIsIl91bnRhZ2dlZEV4cHVuZ2VIYW5kbGVyIiwiX3VudGFnZ2VkRmV0Y2hIYW5kbGVyIiwiY3JlYXRlTG9nZ2VyIiwibG9nTGV2ZWwiLCJMT0dfTEVWRUxfQUxMIiwiY2xlYXJUaW1lb3V0IiwiY29ubmVjdCIsIl90aGlzIiwib3BlbkNvbm5lY3Rpb24iLCJ1cGdyYWRlQ29ubmVjdGlvbiIsInVwZGF0ZUlkIiwibG9nZ2VyIiwid2FybiIsIm1lc3NhZ2UiLCJsb2dpbiIsImNvbXByZXNzQ29ubmVjdGlvbiIsImRlYnVnIiwiY2xvc2UiLCJjb25uZWN0aW9uVGltZW91dCIsInNldFRpbWVvdXQiLCJFcnJvciIsIl9jaGFuZ2VTdGF0ZSIsIm9ucmVhZHkiLCJ1cGRhdGVDYXBhYmlsaXR5IiwiY2F0Y2giLCJsb2dvdXQiLCJfdGhpczIiLCJfdGhpczMiLCJpZCIsIl90aGlzNCIsImluZGV4T2YiLCJjb21tYW5kIiwiYXR0cmlidXRlcyIsImZsYXR0ZW4iLCJPYmplY3QiLCJlbnRyaWVzIiwiZXhlYyIsImxpc3QiLCJwYXRoT3IiLCJtYXAiLCJ2YWx1ZXMiLCJrZXlzIiwiZmlsdGVyIiwiXyIsImkiLCJmcm9tUGFpcnMiLCJ6aXAiLCJfc2hvdWxkU2VsZWN0TWFpbGJveCIsInBhdGgiLCJjdHgiLCJwcmV2aW91c1NlbGVjdCIsImdldFByZXZpb3VzbHlRdWV1ZWQiLCJyZXF1ZXN0IiwicGF0aEF0dHJpYnV0ZSIsImZpbmQiLCJhdHRyaWJ1dGUiLCJ0eXBlIiwic2VsZWN0TWFpbGJveCIsIl90aGlzNSIsInF1ZXJ5IiwicmVhZE9ubHkiLCJjb25kc3RvcmUiLCJwdXNoIiwibWFpbGJveEluZm8iLCJwYXJzZVNFTEVDVCIsImxpc3ROYW1lc3BhY2VzIiwiX3RoaXM2IiwicGFyc2VOQU1FU1BBQ0UiLCJsaXN0TWFpbGJveGVzIiwiX3RoaXM3IiwidHJlZSIsInJvb3QiLCJjaGlsZHJlbiIsImxpc3RSZXNwb25zZSIsImZvckVhY2giLCJpdGVtIiwiYXR0ciIsImxlbmd0aCIsImRlbGltIiwiYnJhbmNoIiwiX2Vuc3VyZVBhdGgiLCJmbGFncyIsImxpc3RlZCIsImNoZWNrU3BlY2lhbFVzZSIsImxzdWJSZXNwb25zZSIsImxzdWIiLCJmbGFnIiwidW5pb24iLCJzdWJzY3JpYmVkIiwibWFpbGJveFN0YXR1cyIsIl90aGlzOCIsInN0YXR1c0RhdGFJdGVtcyIsInN0YXR1c0F0dHJpYnV0ZXMiLCJzdGF0dXNEYXRhSXRlbSIsInBhcnNlU1RBVFVTIiwiY3JlYXRlTWFpbGJveCIsIl90aGlzOSIsImltYXBFbmNvZGUiLCJjb2RlIiwiZGVsZXRlTWFpbGJveCIsImxpc3RNZXNzYWdlcyIsInNlcXVlbmNlIiwiaXRlbXMiLCJmYXN0IiwiX3RoaXMxMCIsImJ1aWxkRkVUQ0hDb21tYW5kIiwicHJlY2hlY2siLCJwYXJzZUZFVENIIiwic2VhcmNoIiwiX3RoaXMxMSIsImJ1aWxkU0VBUkNIQ29tbWFuZCIsInBhcnNlU0VBUkNIIiwic2V0RmxhZ3MiLCJBcnJheSIsImlzQXJyYXkiLCJjb25jYXQiLCJhZGQiLCJzZXQiLCJyZW1vdmUiLCJzdG9yZSIsImFjdGlvbiIsIl90aGlzMTIiLCJidWlsZFNUT1JFQ29tbWFuZCIsInVwbG9hZCIsImRlc3RpbmF0aW9uIiwiX3RoaXMxMyIsInBhcnNlQVBQRU5EIiwiZGVsZXRlTWVzc2FnZXMiLCJfdGhpczE0IiwidXNlVWlkUGx1cyIsImJ5VWlkIiwidWlkRXhwdW5nZUNvbW1hbmQiLCJjbWQiLCJjb3B5TWVzc2FnZXMiLCJfdGhpczE1IiwicGFyc2VDT1BZIiwibW92ZU1lc3NhZ2VzIiwiX3RoaXMxNiIsIl90aGlzMTciLCJjb21wcmVzc2VkIiwiX3RoaXMxOCIsInhvYXV0aDIiLCJidWlsZFhPQXV0aDJUb2tlbiIsInVzZXIiLCJzZW5zaXRpdmUiLCJlcnJvclJlc3BvbnNlRXhwZWN0c0VtcHR5TGluZSIsInBhc3MiLCJjYXBhYmlsaXR5IiwicGF5bG9hZCIsIkNBUEFCSUxJVFkiLCJwb3AiLCJjYXBhIiwidG9VcHBlckNhc2UiLCJ0cmltIiwiYWNjZXB0VW50YWdnZWQiLCJfdGhpczE5IiwiYnJlYWtJZGxlIiwiZW5xdWV1ZUNvbW1hbmQiLCJlbnRlcklkbGUiLCJzdXBwb3J0c0lkbGUiLCJzZW5kIiwiX3RoaXMyMCIsInNlY3VyZU1vZGUiLCJ1cGdyYWRlIiwiZm9yY2VkIiwiX3RoaXMyMSIsImhhc0NhcGFiaWxpdHkiLCJwaXBlIiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwibnIiLCJGRVRDSCIsInNoaWZ0IiwibmV3U3RhdGUiLCJkZWxpbWl0ZXIiLCJuYW1lcyIsInNwbGl0IiwiZm91bmQiLCJqIiwiX2NvbXBhcmVNYWlsYm94TmFtZXMiLCJpbWFwRGVjb2RlIiwic2xpY2UiLCJqb2luIiwiYSIsImIiLCJjcmVhdG9yIiwiY3JlYXRlRGVmYXVsdExvZ2dlciIsIm1zZ3MiLCJMT0dfTEVWRUxfREVCVUciLCJMT0dfTEVWRUxfSU5GTyIsIkxPR19MRVZFTF9XQVJOIiwiTE9HX0xFVkVMX0VSUk9SIl0sInNvdXJjZXMiOlsiLi4vc3JjL2NsaWVudC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBtYXAsIHBpcGUsIHVuaW9uLCB6aXAsIGZyb21QYWlycywgcHJvcE9yLCBwYXRoT3IsIGZsYXR0ZW4gfSBmcm9tICdyYW1kYSdcbmltcG9ydCB7IGltYXBFbmNvZGUsIGltYXBEZWNvZGUgfSBmcm9tICdlbWFpbGpzLXV0ZjcnXG5pbXBvcnQge1xuICBwYXJzZUFQUEVORCxcbiAgcGFyc2VDT1BZLFxuICBwYXJzZU5BTUVTUEFDRSxcbiAgcGFyc2VTRUxFQ1QsXG4gIHBhcnNlRkVUQ0gsXG4gIHBhcnNlU0VBUkNILFxuICBwYXJzZVNUQVRVU1xufSBmcm9tICcuL2NvbW1hbmQtcGFyc2VyJ1xuaW1wb3J0IHtcbiAgYnVpbGRGRVRDSENvbW1hbmQsXG4gIGJ1aWxkWE9BdXRoMlRva2VuLFxuICBidWlsZFNFQVJDSENvbW1hbmQsXG4gIGJ1aWxkU1RPUkVDb21tYW5kXG59IGZyb20gJy4vY29tbWFuZC1idWlsZGVyJ1xuXG5pbXBvcnQgY3JlYXRlRGVmYXVsdExvZ2dlciBmcm9tICcuL2xvZ2dlcidcbmltcG9ydCBJbWFwQ2xpZW50IGZyb20gJy4vaW1hcCdcbmltcG9ydCB7XG4gIExPR19MRVZFTF9FUlJPUixcbiAgTE9HX0xFVkVMX1dBUk4sXG4gIExPR19MRVZFTF9JTkZPLFxuICBMT0dfTEVWRUxfREVCVUcsXG4gIExPR19MRVZFTF9BTExcbn0gZnJvbSAnLi9jb21tb24nXG5cbmltcG9ydCB7XG4gIGNoZWNrU3BlY2lhbFVzZVxufSBmcm9tICcuL3NwZWNpYWwtdXNlJ1xuXG5leHBvcnQgY29uc3QgVElNRU9VVF9DT05ORUNUSU9OID0gOTAgKiAxMDAwIC8vIE1pbGxpc2Vjb25kcyB0byB3YWl0IGZvciB0aGUgSU1BUCBncmVldGluZyBmcm9tIHRoZSBzZXJ2ZXJcbmV4cG9ydCBjb25zdCBUSU1FT1VUX05PT1AgPSA2MCAqIDEwMDAgLy8gTWlsbGlzZWNvbmRzIGJldHdlZW4gTk9PUCBjb21tYW5kcyB3aGlsZSBpZGxpbmdcbmV4cG9ydCBjb25zdCBUSU1FT1VUX0lETEUgPSA2MCAqIDEwMDAgLy8gTWlsbGlzZWNvbmRzIHVudGlsIElETEUgY29tbWFuZCBpcyBjYW5jZWxsZWRcblxuZXhwb3J0IGNvbnN0IFNUQVRFX0NPTk5FQ1RJTkcgPSAxXG5leHBvcnQgY29uc3QgU1RBVEVfTk9UX0FVVEhFTlRJQ0FURUQgPSAyXG5leHBvcnQgY29uc3QgU1RBVEVfQVVUSEVOVElDQVRFRCA9IDNcbmV4cG9ydCBjb25zdCBTVEFURV9TRUxFQ1RFRCA9IDRcbmV4cG9ydCBjb25zdCBTVEFURV9MT0dPVVQgPSA1XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX0NMSUVOVF9JRCA9IHtcbiAgbmFtZTogJ2VtYWlsanMtaW1hcC1jbGllbnQnXG59XG5cbi8qKlxuICogZW1haWxqcyBJTUFQIGNsaWVudFxuICpcbiAqIEBjb25zdHJ1Y3RvclxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBbaG9zdD0nbG9jYWxob3N0J10gSG9zdG5hbWUgdG8gY29uZW5jdCB0b1xuICogQHBhcmFtIHtOdW1iZXJ9IFtwb3J0PTE0M10gUG9ydCBudW1iZXIgdG8gY29ubmVjdCB0b1xuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSBPcHRpb25hbCBvcHRpb25zIG9iamVjdFxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBDbGllbnQge1xuICBjb25zdHJ1Y3RvciAoaG9zdCwgcG9ydCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy50aW1lb3V0Q29ubmVjdGlvbiA9IFRJTUVPVVRfQ09OTkVDVElPTlxuICAgIHRoaXMudGltZW91dE5vb3AgPSBUSU1FT1VUX05PT1BcbiAgICB0aGlzLnRpbWVvdXRJZGxlID0gVElNRU9VVF9JRExFXG5cbiAgICB0aGlzLnNlcnZlcklkID0gZmFsc2UgLy8gUkZDIDI5NzEgU2VydmVyIElEIGFzIGtleSB2YWx1ZSBwYWlyc1xuXG4gICAgLy8gRXZlbnQgcGxhY2Vob2xkZXJzXG4gICAgdGhpcy5vbmNlcnQgPSBudWxsXG4gICAgdGhpcy5vbnVwZGF0ZSA9IG51bGxcbiAgICB0aGlzLm9uc2VsZWN0bWFpbGJveCA9IG51bGxcbiAgICB0aGlzLm9uY2xvc2VtYWlsYm94ID0gbnVsbFxuXG4gICAgdGhpcy5faG9zdCA9IGhvc3RcbiAgICB0aGlzLl9jbGllbnRJZCA9IHByb3BPcihERUZBVUxUX0NMSUVOVF9JRCwgJ2lkJywgb3B0aW9ucylcbiAgICB0aGlzLl9zdGF0ZSA9IGZhbHNlIC8vIEN1cnJlbnQgc3RhdGVcbiAgICB0aGlzLl9hdXRoZW50aWNhdGVkID0gZmFsc2UgLy8gSXMgdGhlIGNvbm5lY3Rpb24gYXV0aGVudGljYXRlZFxuICAgIHRoaXMuX2NhcGFiaWxpdHkgPSBbXSAvLyBMaXN0IG9mIGV4dGVuc2lvbnMgdGhlIHNlcnZlciBzdXBwb3J0c1xuICAgIHRoaXMuX3NlbGVjdGVkTWFpbGJveCA9IGZhbHNlIC8vIFNlbGVjdGVkIG1haWxib3hcbiAgICB0aGlzLl9lbnRlcmVkSWRsZSA9IGZhbHNlXG4gICAgdGhpcy5faWRsZVRpbWVvdXQgPSBmYWxzZVxuICAgIHRoaXMuX2VuYWJsZUNvbXByZXNzaW9uID0gISFvcHRpb25zLmVuYWJsZUNvbXByZXNzaW9uXG4gICAgdGhpcy5fYXV0aCA9IG9wdGlvbnMuYXV0aFxuICAgIHRoaXMuX3JlcXVpcmVUTFMgPSAhIW9wdGlvbnMucmVxdWlyZVRMU1xuICAgIHRoaXMuX2lnbm9yZVRMUyA9ICEhb3B0aW9ucy5pZ25vcmVUTFNcblxuICAgIHRoaXMuY2xpZW50ID0gbmV3IEltYXBDbGllbnQoaG9zdCwgcG9ydCwgb3B0aW9ucykgLy8gSU1BUCBjbGllbnQgb2JqZWN0XG5cbiAgICAvLyBFdmVudCBIYW5kbGVyc1xuICAgIHRoaXMuY2xpZW50Lm9uZXJyb3IgPSB0aGlzLl9vbkVycm9yLmJpbmQodGhpcylcbiAgICB0aGlzLmNsaWVudC5vbmNlcnQgPSAoY2VydCkgPT4gKHRoaXMub25jZXJ0ICYmIHRoaXMub25jZXJ0KGNlcnQpKSAvLyBhbGxvd3MgY2VydGlmaWNhdGUgaGFuZGxpbmcgZm9yIHBsYXRmb3JtcyB3L28gbmF0aXZlIHRscyBzdXBwb3J0XG4gICAgdGhpcy5jbGllbnQub25pZGxlID0gKCkgPT4gdGhpcy5fb25JZGxlKCkgLy8gc3RhcnQgaWRsaW5nXG5cbiAgICAvLyBEZWZhdWx0IGhhbmRsZXJzIGZvciB1bnRhZ2dlZCByZXNwb25zZXNcbiAgICB0aGlzLmNsaWVudC5zZXRIYW5kbGVyKCdjYXBhYmlsaXR5JywgKHJlc3BvbnNlKSA9PiB0aGlzLl91bnRhZ2dlZENhcGFiaWxpdHlIYW5kbGVyKHJlc3BvbnNlKSkgLy8gY2FwYWJpbGl0eSB1cGRhdGVzXG4gICAgdGhpcy5jbGllbnQuc2V0SGFuZGxlcignb2snLCAocmVzcG9uc2UpID0+IHRoaXMuX3VudGFnZ2VkT2tIYW5kbGVyKHJlc3BvbnNlKSkgLy8gbm90aWZpY2F0aW9uc1xuICAgIHRoaXMuY2xpZW50LnNldEhhbmRsZXIoJ2V4aXN0cycsIChyZXNwb25zZSkgPT4gdGhpcy5fdW50YWdnZWRFeGlzdHNIYW5kbGVyKHJlc3BvbnNlKSkgLy8gbWVzc2FnZSBjb3VudCBoYXMgY2hhbmdlZFxuICAgIHRoaXMuY2xpZW50LnNldEhhbmRsZXIoJ2V4cHVuZ2UnLCAocmVzcG9uc2UpID0+IHRoaXMuX3VudGFnZ2VkRXhwdW5nZUhhbmRsZXIocmVzcG9uc2UpKSAvLyBtZXNzYWdlIGhhcyBiZWVuIGRlbGV0ZWRcbiAgICB0aGlzLmNsaWVudC5zZXRIYW5kbGVyKCdmZXRjaCcsIChyZXNwb25zZSkgPT4gdGhpcy5fdW50YWdnZWRGZXRjaEhhbmRsZXIocmVzcG9uc2UpKSAvLyBtZXNzYWdlIGhhcyBiZWVuIHVwZGF0ZWQgKGVnLiBmbGFnIGNoYW5nZSlcblxuICAgIC8vIEFjdGl2YXRlIGxvZ2dpbmdcbiAgICB0aGlzLmNyZWF0ZUxvZ2dlcigpXG4gICAgdGhpcy5sb2dMZXZlbCA9IHByb3BPcihMT0dfTEVWRUxfQUxMLCAnbG9nTGV2ZWwnLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBpZiB0aGUgbG93ZXItbGV2ZWwgSW1hcENsaWVudCBoYXMgZW5jb3VudGVyZWQgYW4gdW5yZWNvdmVyYWJsZVxuICAgKiBlcnJvciBkdXJpbmcgb3BlcmF0aW9uLiBDbGVhbnMgdXAgYW5kIHByb3BhZ2F0ZXMgdGhlIGVycm9yIHVwd2FyZHMuXG4gICAqL1xuICBfb25FcnJvciAoZXJyKSB7XG4gICAgLy8gbWFrZSBzdXJlIG5vIGlkbGUgdGltZW91dCBpcyBwZW5kaW5nIGFueW1vcmVcbiAgICBjbGVhclRpbWVvdXQodGhpcy5faWRsZVRpbWVvdXQpXG5cbiAgICAvLyBwcm9wYWdhdGUgdGhlIGVycm9yIHVwd2FyZHNcbiAgICB0aGlzLm9uZXJyb3IgJiYgdGhpcy5vbmVycm9yKGVycilcbiAgfVxuXG4gIC8vXG4gIC8vXG4gIC8vIFBVQkxJQyBBUElcbiAgLy9cbiAgLy9cblxuICAvKipcbiAgICogSW5pdGlhdGUgY29ubmVjdGlvbiBhbmQgbG9naW4gdG8gdGhlIElNQVAgc2VydmVyXG4gICAqXG4gICAqIEByZXR1cm5zIHtQcm9taXNlfSBQcm9taXNlIHdoZW4gbG9naW4gcHJvY2VkdXJlIGlzIGNvbXBsZXRlXG4gICAqL1xuICBhc3luYyBjb25uZWN0ICgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5vcGVuQ29ubmVjdGlvbigpXG4gICAgICBhd2FpdCB0aGlzLnVwZ3JhZGVDb25uZWN0aW9uKClcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlSWQodGhpcy5fY2xpZW50SWQpXG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignRmFpbGVkIHRvIHVwZGF0ZSBzZXJ2ZXIgaWQhJywgZXJyLm1lc3NhZ2UpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMubG9naW4odGhpcy5fYXV0aClcbiAgICAgIGF3YWl0IHRoaXMuY29tcHJlc3NDb25uZWN0aW9uKClcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDb25uZWN0aW9uIGVzdGFibGlzaGVkLCByZWFkeSB0byByb2xsIScpXG4gICAgICB0aGlzLmNsaWVudC5vbmVycm9yID0gdGhpcy5fb25FcnJvci5iaW5kKHRoaXMpXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignQ291bGQgbm90IGNvbm5lY3QgdG8gc2VydmVyJywgZXJyKVxuICAgICAgdGhpcy5jbG9zZShlcnIpIC8vIHdlIGRvbid0IHJlYWxseSBjYXJlIHdoZXRoZXIgdGhpcyB3b3JrcyBvciBub3RcbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWF0ZSBjb25uZWN0aW9uIHRvIHRoZSBJTUFQIHNlcnZlclxuICAgKlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZX0gY2FwYWJpbGl0eSBvZiBzZXJ2ZXIgd2l0aG91dCBsb2dpblxuICAgKi9cbiAgb3BlbkNvbm5lY3Rpb24gKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBjb25uZWN0aW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gcmVqZWN0KG5ldyBFcnJvcignVGltZW91dCBjb25uZWN0aW5nIHRvIHNlcnZlcicpKSwgdGhpcy50aW1lb3V0Q29ubmVjdGlvbilcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDb25uZWN0aW5nIHRvJywgdGhpcy5jbGllbnQuaG9zdCwgJzonLCB0aGlzLmNsaWVudC5wb3J0KVxuICAgICAgdGhpcy5fY2hhbmdlU3RhdGUoU1RBVEVfQ09OTkVDVElORylcbiAgICAgIHRoaXMuY2xpZW50LmNvbm5lY3QoKS50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1NvY2tldCBvcGVuZWQsIHdhaXRpbmcgZm9yIGdyZWV0aW5nIGZyb20gdGhlIHNlcnZlci4uLicpXG5cbiAgICAgICAgdGhpcy5jbGllbnQub25yZWFkeSA9ICgpID0+IHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQoY29ubmVjdGlvblRpbWVvdXQpXG4gICAgICAgICAgdGhpcy5fY2hhbmdlU3RhdGUoU1RBVEVfTk9UX0FVVEhFTlRJQ0FURUQpXG4gICAgICAgICAgdGhpcy51cGRhdGVDYXBhYmlsaXR5KClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHJlc29sdmUodGhpcy5fY2FwYWJpbGl0eSkpXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmNsaWVudC5vbmVycm9yID0gKGVycikgPT4ge1xuICAgICAgICAgIGNsZWFyVGltZW91dChjb25uZWN0aW9uVGltZW91dClcbiAgICAgICAgICByZWplY3QoZXJyKVxuICAgICAgICB9XG4gICAgICB9KS5jYXRjaChyZWplY3QpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dvdXRcbiAgICpcbiAgICogU2VuZCBMT0dPVVQsIHRvIHdoaWNoIHRoZSBzZXJ2ZXIgcmVzcG9uZHMgYnkgY2xvc2luZyB0aGUgY29ubmVjdGlvbi5cbiAgICogVXNlIGlzIGRpc2NvdXJhZ2VkIGlmIG5ldHdvcmsgc3RhdHVzIGlzIHVuY2xlYXIhIElmIG5ldHdvcmtzIHN0YXR1cyBpc1xuICAgKiB1bmNsZWFyLCBwbGVhc2UgdXNlICNjbG9zZSBpbnN0ZWFkIVxuICAgKlxuICAgKiBMT0dPVVQgZGV0YWlsczpcbiAgICogICBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzUwMSNzZWN0aW9uLTYuMS4zXG4gICAqXG4gICAqIEByZXR1cm5zIHtQcm9taXNlfSBSZXNvbHZlcyB3aGVuIHNlcnZlciBoYXMgY2xvc2VkIHRoZSBjb25uZWN0aW9uXG4gICAqL1xuICBhc3luYyBsb2dvdXQgKCkge1xuICAgIHRoaXMuX2NoYW5nZVN0YXRlKFNUQVRFX0xPR09VVClcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTG9nZ2luZyBvdXQuLi4nKVxuICAgIGF3YWl0IHRoaXMuY2xpZW50LmxvZ291dCgpXG4gICAgY2xlYXJUaW1lb3V0KHRoaXMuX2lkbGVUaW1lb3V0KVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmNlLWNsb3NlcyB0aGUgY3VycmVudCBjb25uZWN0aW9uIGJ5IGNsb3NpbmcgdGhlIFRDUCBzb2NrZXQuXG4gICAqXG4gICAqIEByZXR1cm5zIHtQcm9taXNlfSBSZXNvbHZlcyB3aGVuIHNvY2tldCBpcyBjbG9zZWRcbiAgICovXG4gIGFzeW5jIGNsb3NlIChlcnIpIHtcbiAgICB0aGlzLl9jaGFuZ2VTdGF0ZShTVEFURV9MT0dPVVQpXG4gICAgY2xlYXJUaW1lb3V0KHRoaXMuX2lkbGVUaW1lb3V0KVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDbG9zaW5nIGNvbm5lY3Rpb24uLi4nKVxuICAgIGF3YWl0IHRoaXMuY2xpZW50LmNsb3NlKGVycilcbiAgICBjbGVhclRpbWVvdXQodGhpcy5faWRsZVRpbWVvdXQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBJRCBjb21tYW5kLCBwYXJzZXMgSUQgcmVzcG9uc2UsIHNldHMgdGhpcy5zZXJ2ZXJJZFxuICAgKlxuICAgKiBJRCBkZXRhaWxzOlxuICAgKiAgIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzI5NzFcbiAgICpcbiAgICogQHBhcmFtIHtPYmplY3R9IGlkIElEIGFzIEpTT04gb2JqZWN0LiBTZWUgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMjk3MSNzZWN0aW9uLTMuMyBmb3IgcG9zc2libGUgdmFsdWVzXG4gICAqIEByZXR1cm5zIHtQcm9taXNlfSBSZXNvbHZlcyB3aGVuIHJlc3BvbnNlIGhhcyBiZWVuIHBhcnNlZFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlSWQgKGlkKSB7XG4gICAgaWYgKHRoaXMuX2NhcGFiaWxpdHkuaW5kZXhPZignSUQnKSA8IDApIHJldHVyblxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ1VwZGF0aW5nIGlkLi4uJylcblxuICAgIGNvbnN0IGNvbW1hbmQgPSAnSUQnXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGlkID8gW2ZsYXR0ZW4oT2JqZWN0LmVudHJpZXMoaWQpKV0gOiBbbnVsbF1cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZXhlYyh7IGNvbW1hbmQsIGF0dHJpYnV0ZXMgfSwgJ0lEJylcbiAgICBjb25zdCBsaXN0ID0gZmxhdHRlbihwYXRoT3IoW10sIFsncGF5bG9hZCcsICdJRCcsICcwJywgJ2F0dHJpYnV0ZXMnLCAnMCddLCByZXNwb25zZSkubWFwKE9iamVjdC52YWx1ZXMpKVxuICAgIGNvbnN0IGtleXMgPSBsaXN0LmZpbHRlcigoXywgaSkgPT4gaSAlIDIgPT09IDApXG4gICAgY29uc3QgdmFsdWVzID0gbGlzdC5maWx0ZXIoKF8sIGkpID0+IGkgJSAyID09PSAxKVxuICAgIHRoaXMuc2VydmVySWQgPSBmcm9tUGFpcnMoemlwKGtleXMsIHZhbHVlcykpXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ1NlcnZlciBpZCB1cGRhdGVkIScsIHRoaXMuc2VydmVySWQpXG4gIH1cblxuICBfc2hvdWxkU2VsZWN0TWFpbGJveCAocGF0aCwgY3R4KSB7XG4gICAgaWYgKCFjdHgpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNTZWxlY3QgPSB0aGlzLmNsaWVudC5nZXRQcmV2aW91c2x5UXVldWVkKFsnU0VMRUNUJywgJ0VYQU1JTkUnXSwgY3R4KVxuICAgIGlmIChwcmV2aW91c1NlbGVjdCAmJiBwcmV2aW91c1NlbGVjdC5yZXF1ZXN0LmF0dHJpYnV0ZXMpIHtcbiAgICAgIGNvbnN0IHBhdGhBdHRyaWJ1dGUgPSBwcmV2aW91c1NlbGVjdC5yZXF1ZXN0LmF0dHJpYnV0ZXMuZmluZCgoYXR0cmlidXRlKSA9PiBhdHRyaWJ1dGUudHlwZSA9PT0gJ1NUUklORycpXG4gICAgICBpZiAocGF0aEF0dHJpYnV0ZSkge1xuICAgICAgICByZXR1cm4gcGF0aEF0dHJpYnV0ZS52YWx1ZSAhPT0gcGF0aFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9zZWxlY3RlZE1haWxib3ggIT09IHBhdGhcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIFNFTEVDVCBvciBFWEFNSU5FIHRvIG9wZW4gYSBtYWlsYm94XG4gICAqXG4gICAqIFNFTEVDVCBkZXRhaWxzOlxuICAgKiAgIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM1MDEjc2VjdGlvbi02LjMuMVxuICAgKiBFWEFNSU5FIGRldGFpbHM6XG4gICAqICAgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzUwMSNzZWN0aW9uLTYuMy4yXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoIEZ1bGwgcGF0aCB0byBtYWlsYm94XG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gT3B0aW9ucyBvYmplY3RcbiAgICogQHJldHVybnMge1Byb21pc2V9IFByb21pc2Ugd2l0aCBpbmZvcm1hdGlvbiBhYm91dCB0aGUgc2VsZWN0ZWQgbWFpbGJveFxuICAgKi9cbiAgYXN5bmMgc2VsZWN0TWFpbGJveCAocGF0aCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcXVlcnkgPSB7XG4gICAgICBjb21tYW5kOiBvcHRpb25zLnJlYWRPbmx5ID8gJ0VYQU1JTkUnIDogJ1NFTEVDVCcsXG4gICAgICBhdHRyaWJ1dGVzOiBbeyB0eXBlOiAnU1RSSU5HJywgdmFsdWU6IHBhdGggfV1cbiAgICB9XG5cbiAgICBpZiAob3B0aW9ucy5jb25kc3RvcmUgJiYgdGhpcy5fY2FwYWJpbGl0eS5pbmRleE9mKCdDT05EU1RPUkUnKSA+PSAwKSB7XG4gICAgICBxdWVyeS5hdHRyaWJ1dGVzLnB1c2goW3sgdHlwZTogJ0FUT00nLCB2YWx1ZTogJ0NPTkRTVE9SRScgfV0pXG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ09wZW5pbmcnLCBwYXRoLCAnLi4uJylcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZXhlYyhxdWVyeSwgWydFWElTVFMnLCAnRkxBR1MnLCAnT0snXSwgeyBjdHg6IG9wdGlvbnMuY3R4IH0pXG4gICAgY29uc3QgbWFpbGJveEluZm8gPSBwYXJzZVNFTEVDVChyZXNwb25zZSlcblxuICAgIHRoaXMuX2NoYW5nZVN0YXRlKFNUQVRFX1NFTEVDVEVEKVxuXG4gICAgaWYgKHRoaXMuX3NlbGVjdGVkTWFpbGJveCAhPT0gcGF0aCAmJiB0aGlzLm9uY2xvc2VtYWlsYm94KSB7XG4gICAgICBhd2FpdCB0aGlzLm9uY2xvc2VtYWlsYm94KHRoaXMuX3NlbGVjdGVkTWFpbGJveClcbiAgICB9XG4gICAgdGhpcy5fc2VsZWN0ZWRNYWlsYm94ID0gcGF0aFxuICAgIGlmICh0aGlzLm9uc2VsZWN0bWFpbGJveCkge1xuICAgICAgYXdhaXQgdGhpcy5vbnNlbGVjdG1haWxib3gocGF0aCwgbWFpbGJveEluZm8pXG4gICAgfVxuXG4gICAgcmV0dXJuIG1haWxib3hJbmZvXG4gIH1cblxuICAvKipcbiAgICogUnVucyBOQU1FU1BBQ0UgY29tbWFuZFxuICAgKlxuICAgKiBOQU1FU1BBQ0UgZGV0YWlsczpcbiAgICogICBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMjM0MlxuICAgKlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZX0gUHJvbWlzZSB3aXRoIG5hbWVzcGFjZSBvYmplY3RcbiAgICovXG4gIGFzeW5jIGxpc3ROYW1lc3BhY2VzICgpIHtcbiAgICBpZiAodGhpcy5fY2FwYWJpbGl0eS5pbmRleE9mKCdOQU1FU1BBQ0UnKSA8IDApIHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ0xpc3RpbmcgbmFtZXNwYWNlcy4uLicpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmV4ZWMoJ05BTUVTUEFDRScsICdOQU1FU1BBQ0UnKVxuICAgIHJldHVybiBwYXJzZU5BTUVTUEFDRShyZXNwb25zZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIExJU1QgYW5kIExTVUIgY29tbWFuZHMuIFJldHJpZXZlcyBhIHRyZWUgb2YgYXZhaWxhYmxlIG1haWxib3hlc1xuICAgKlxuICAgKiBMSVNUIGRldGFpbHM6XG4gICAqICAgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzUwMSNzZWN0aW9uLTYuMy44XG4gICAqIExTVUIgZGV0YWlsczpcbiAgICogICBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNTAxI3NlY3Rpb24tNi4zLjlcbiAgICpcbiAgICogQHJldHVybnMge1Byb21pc2V9IFByb21pc2Ugd2l0aCBsaXN0IG9mIG1haWxib3hlc1xuICAgKi9cbiAgYXN5bmMgbGlzdE1haWxib3hlcyAoKSB7XG4gICAgY29uc3QgdHJlZSA9IHsgcm9vdDogdHJ1ZSwgY2hpbGRyZW46IFtdIH1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdMaXN0aW5nIG1haWxib3hlcy4uLicpXG4gICAgY29uc3QgbGlzdFJlc3BvbnNlID0gYXdhaXQgdGhpcy5leGVjKHsgY29tbWFuZDogJ0xJU1QnLCBhdHRyaWJ1dGVzOiBbJycsICcqJ10gfSwgJ0xJU1QnKVxuICAgIGNvbnN0IGxpc3QgPSBwYXRoT3IoW10sIFsncGF5bG9hZCcsICdMSVNUJ10sIGxpc3RSZXNwb25zZSlcbiAgICBsaXN0LmZvckVhY2goaXRlbSA9PiB7XG4gICAgICBjb25zdCBhdHRyID0gcHJvcE9yKFtdLCAnYXR0cmlidXRlcycsIGl0ZW0pXG4gICAgICBpZiAoYXR0ci5sZW5ndGggPCAzKSByZXR1cm5cblxuICAgICAgY29uc3QgcGF0aCA9IHBhdGhPcignJywgWycyJywgJ3ZhbHVlJ10sIGF0dHIpXG4gICAgICBjb25zdCBkZWxpbSA9IHBhdGhPcignLycsIFsnMScsICd2YWx1ZSddLCBhdHRyKVxuICAgICAgY29uc3QgYnJhbmNoID0gdGhpcy5fZW5zdXJlUGF0aCh0cmVlLCBwYXRoLCBkZWxpbSlcbiAgICAgIGJyYW5jaC5mbGFncyA9IHByb3BPcihbXSwgJzAnLCBhdHRyKS5tYXAoKHsgdmFsdWUgfSkgPT4gdmFsdWUgfHwgJycpXG4gICAgICBicmFuY2gubGlzdGVkID0gdHJ1ZVxuICAgICAgY2hlY2tTcGVjaWFsVXNlKGJyYW5jaClcbiAgICB9KVxuXG4gICAgY29uc3QgbHN1YlJlc3BvbnNlID0gYXdhaXQgdGhpcy5leGVjKHsgY29tbWFuZDogJ0xTVUInLCBhdHRyaWJ1dGVzOiBbJycsICcqJ10gfSwgJ0xTVUInKVxuICAgIGNvbnN0IGxzdWIgPSBwYXRoT3IoW10sIFsncGF5bG9hZCcsICdMU1VCJ10sIGxzdWJSZXNwb25zZSlcbiAgICBsc3ViLmZvckVhY2goKGl0ZW0pID0+IHtcbiAgICAgIGNvbnN0IGF0dHIgPSBwcm9wT3IoW10sICdhdHRyaWJ1dGVzJywgaXRlbSlcbiAgICAgIGlmIChhdHRyLmxlbmd0aCA8IDMpIHJldHVyblxuXG4gICAgICBjb25zdCBwYXRoID0gcGF0aE9yKCcnLCBbJzInLCAndmFsdWUnXSwgYXR0cilcbiAgICAgIGNvbnN0IGRlbGltID0gcGF0aE9yKCcvJywgWycxJywgJ3ZhbHVlJ10sIGF0dHIpXG4gICAgICBjb25zdCBicmFuY2ggPSB0aGlzLl9lbnN1cmVQYXRoKHRyZWUsIHBhdGgsIGRlbGltKVxuICAgICAgcHJvcE9yKFtdLCAnMCcsIGF0dHIpLm1hcCgoZmxhZyA9ICcnKSA9PiB7IGJyYW5jaC5mbGFncyA9IHVuaW9uKGJyYW5jaC5mbGFncywgW2ZsYWddKSB9KVxuICAgICAgYnJhbmNoLnN1YnNjcmliZWQgPSB0cnVlXG4gICAgfSlcblxuICAgIHJldHVybiB0cmVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYWlsYm94IFNUQVRVU1xuICAgKlxuICAgKiBTVEFUVVMgZGV0YWlsczpcbiAgICogIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNTAxI3NlY3Rpb24tNi4zLjEwXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoIEZ1bGwgcGF0aCB0byBtYWlsYm94XG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gT3B0aW9ucyBvYmplY3RcbiAgICogQHJldHVybnMge1Byb21pc2V9IFByb21pc2Ugd2l0aCBpbmZvcm1hdGlvbiBhYm91dCB0aGUgc2VsZWN0ZWQgbWFpbGJveFxuICAgKi9cbiAgYXN5bmMgbWFpbGJveFN0YXR1cyAocGF0aCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgc3RhdHVzRGF0YUl0ZW1zID0gWydVSURORVhUJywgJ01FU1NBR0VTJ11cblxuICAgIGlmIChvcHRpb25zLmNvbmRzdG9yZSAmJiB0aGlzLl9jYXBhYmlsaXR5LmluZGV4T2YoJ0NPTkRTVE9SRScpID49IDApIHtcbiAgICAgIHN0YXR1c0RhdGFJdGVtcy5wdXNoKCdISUdIRVNUTU9EU0VRJylcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0dXNBdHRyaWJ1dGVzID0gc3RhdHVzRGF0YUl0ZW1zLm1hcCgoc3RhdHVzRGF0YUl0ZW0pID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdBVE9NJyxcbiAgICAgICAgdmFsdWU6IHN0YXR1c0RhdGFJdGVtXG4gICAgICB9XG4gICAgfSlcblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdPcGVuaW5nJywgcGF0aCwgJy4uLicpXG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZXhlYyh7XG4gICAgICBjb21tYW5kOiAnU1RBVFVTJyxcbiAgICAgIGF0dHJpYnV0ZXM6IFtcbiAgICAgICAgeyB0eXBlOiAnU1RSSU5HJywgdmFsdWU6IHBhdGggfSxcbiAgICAgICAgWy4uLnN0YXR1c0F0dHJpYnV0ZXNdXG4gICAgICBdXG4gICAgfSwgWydTVEFUVVMnXSlcblxuICAgIHJldHVybiBwYXJzZVNUQVRVUyhyZXNwb25zZSwgc3RhdHVzRGF0YUl0ZW1zKVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIG1haWxib3ggd2l0aCB0aGUgZ2l2ZW4gcGF0aC5cbiAgICpcbiAgICogQ1JFQVRFIGRldGFpbHM6XG4gICAqICAgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzUwMSNzZWN0aW9uLTYuMy4zXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoXG4gICAqICAgICBUaGUgcGF0aCBvZiB0aGUgbWFpbGJveCB5b3Ugd291bGQgbGlrZSB0byBjcmVhdGUuICBUaGlzIG1ldGhvZCB3aWxsXG4gICAqICAgICBoYW5kbGUgdXRmNyBlbmNvZGluZyBmb3IgeW91LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZX1cbiAgICogICAgIFByb21pc2UgcmVzb2x2ZXMgaWYgbWFpbGJveCB3YXMgY3JlYXRlZC5cbiAgICogICAgIEluIHRoZSBldmVudCB0aGUgc2VydmVyIHNheXMgTk8gW0FMUkVBRFlFWElTVFNdLCB3ZSB0cmVhdCB0aGF0IGFzIHN1Y2Nlc3MuXG4gICAqL1xuICBhc3luYyBjcmVhdGVNYWlsYm94IChwYXRoKSB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ0NyZWF0aW5nIG1haWxib3gnLCBwYXRoLCAnLi4uJylcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5leGVjKHsgY29tbWFuZDogJ0NSRUFURScsIGF0dHJpYnV0ZXM6IFtpbWFwRW5jb2RlKHBhdGgpXSB9KVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciAmJiBlcnIuY29kZSA9PT0gJ0FMUkVBRFlFWElTVFMnKSB7XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSBhIG1haWxib3ggd2l0aCB0aGUgZ2l2ZW4gcGF0aC5cbiAgICpcbiAgICogREVMRVRFIGRldGFpbHM6XG4gICAqICAgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM1MDEjc2VjdGlvbi02LjMuNFxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICAgKiAgICAgVGhlIHBhdGggb2YgdGhlIG1haWxib3ggeW91IHdvdWxkIGxpa2UgdG8gZGVsZXRlLiAgVGhpcyBtZXRob2Qgd2lsbFxuICAgKiAgICAgaGFuZGxlIHV0ZjcgZW5jb2RpbmcgZm9yIHlvdS5cbiAgICogQHJldHVybnMge1Byb21pc2V9XG4gICAqICAgICBQcm9taXNlIHJlc29sdmVzIGlmIG1haWxib3ggd2FzIGRlbGV0ZWQuXG4gICAqL1xuICBkZWxldGVNYWlsYm94IChwYXRoKSB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ0RlbGV0aW5nIG1haWxib3gnLCBwYXRoLCAnLi4uJylcbiAgICByZXR1cm4gdGhpcy5leGVjKHsgY29tbWFuZDogJ0RFTEVURScsIGF0dHJpYnV0ZXM6IFtpbWFwRW5jb2RlKHBhdGgpXSB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgRkVUQ0ggY29tbWFuZFxuICAgKlxuICAgKiBGRVRDSCBkZXRhaWxzOlxuICAgKiAgIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM1MDEjc2VjdGlvbi02LjQuNVxuICAgKiBDSEFOR0VEU0lOQ0UgZGV0YWlsczpcbiAgICogICBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNDU1MSNzZWN0aW9uLTMuM1xuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aCBUaGUgcGF0aCBmb3IgdGhlIG1haWxib3ggd2hpY2ggc2hvdWxkIGJlIHNlbGVjdGVkIGZvciB0aGUgY29tbWFuZC4gU2VsZWN0cyBtYWlsYm94IGlmIG5lY2Vzc2FyeVxuICAgKiBAcGFyYW0ge1N0cmluZ30gc2VxdWVuY2UgU2VxdWVuY2Ugc2V0LCBlZyAxOiogZm9yIGFsbCBtZXNzYWdlc1xuICAgKiBAcGFyYW0ge09iamVjdH0gW2l0ZW1zXSBNZXNzYWdlIGRhdGEgaXRlbSBuYW1lcyBvciBtYWNyb1xuICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdIFF1ZXJ5IG1vZGlmaWVyc1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZX0gUHJvbWlzZSB3aXRoIHRoZSBmZXRjaGVkIG1lc3NhZ2UgaW5mb1xuICAgKi9cbiAgYXN5bmMgbGlzdE1lc3NhZ2VzIChwYXRoLCBzZXF1ZW5jZSwgaXRlbXMgPSBbeyBmYXN0OiB0cnVlIH1dLCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRmV0Y2hpbmcgbWVzc2FnZXMnLCBzZXF1ZW5jZSwgJ2Zyb20nLCBwYXRoLCAnLi4uJylcbiAgICBjb25zdCBjb21tYW5kID0gYnVpbGRGRVRDSENvbW1hbmQoc2VxdWVuY2UsIGl0ZW1zLCBvcHRpb25zKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5leGVjKGNvbW1hbmQsICdGRVRDSCcsIHtcbiAgICAgIHByZWNoZWNrOiAoY3R4KSA9PiB0aGlzLl9zaG91bGRTZWxlY3RNYWlsYm94KHBhdGgsIGN0eCkgPyB0aGlzLnNlbGVjdE1haWxib3gocGF0aCwgeyBjdHggfSkgOiBQcm9taXNlLnJlc29sdmUoKVxuICAgIH0pXG4gICAgcmV0dXJuIHBhcnNlRkVUQ0gocmVzcG9uc2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBTRUFSQ0ggY29tbWFuZFxuICAgKlxuICAgKiBTRUFSQ0ggZGV0YWlsczpcbiAgICogICBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNTAxI3NlY3Rpb24tNi40LjRcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGggVGhlIHBhdGggZm9yIHRoZSBtYWlsYm94IHdoaWNoIHNob3VsZCBiZSBzZWxlY3RlZCBmb3IgdGhlIGNvbW1hbmQuIFNlbGVjdHMgbWFpbGJveCBpZiBuZWNlc3NhcnlcbiAgICogQHBhcmFtIHtPYmplY3R9IHF1ZXJ5IFNlYXJjaCB0ZXJtc1xuICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdIFF1ZXJ5IG1vZGlmaWVyc1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZX0gUHJvbWlzZSB3aXRoIHRoZSBhcnJheSBvZiBtYXRjaGluZyBzZXEuIG9yIHVpZCBudW1iZXJzXG4gICAqL1xuICBhc3luYyBzZWFyY2ggKHBhdGgsIHF1ZXJ5LCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU2VhcmNoaW5nIGluJywgcGF0aCwgJy4uLicpXG4gICAgY29uc3QgY29tbWFuZCA9IGJ1aWxkU0VBUkNIQ29tbWFuZChxdWVyeSwgb3B0aW9ucylcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZXhlYyhjb21tYW5kLCAnU0VBUkNIJywge1xuICAgICAgcHJlY2hlY2s6IChjdHgpID0+IHRoaXMuX3Nob3VsZFNlbGVjdE1haWxib3gocGF0aCwgY3R4KSA/IHRoaXMuc2VsZWN0TWFpbGJveChwYXRoLCB7IGN0eCB9KSA6IFByb21pc2UucmVzb2x2ZSgpXG4gICAgfSlcbiAgICByZXR1cm4gcGFyc2VTRUFSQ0gocmVzcG9uc2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBTVE9SRSBjb21tYW5kXG4gICAqXG4gICAqIFNUT1JFIGRldGFpbHM6XG4gICAqICAgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzUwMSNzZWN0aW9uLTYuNC42XG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoIFRoZSBwYXRoIGZvciB0aGUgbWFpbGJveCB3aGljaCBzaG91bGQgYmUgc2VsZWN0ZWQgZm9yIHRoZSBjb21tYW5kLiBTZWxlY3RzIG1haWxib3ggaWYgbmVjZXNzYXJ5XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzZXF1ZW5jZSBNZXNzYWdlIHNlbGVjdG9yIHdoaWNoIHRoZSBmbGFnIGNoYW5nZSBpcyBhcHBsaWVkIHRvXG4gICAqIEBwYXJhbSB7QXJyYXl9IGZsYWdzXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gUXVlcnkgbW9kaWZpZXJzXG4gICAqIEByZXR1cm5zIHtQcm9taXNlfSBQcm9taXNlIHdpdGggdGhlIGFycmF5IG9mIG1hdGNoaW5nIHNlcS4gb3IgdWlkIG51bWJlcnNcbiAgICovXG4gIHNldEZsYWdzIChwYXRoLCBzZXF1ZW5jZSwgZmxhZ3MsIG9wdGlvbnMpIHtcbiAgICBsZXQga2V5ID0gJydcbiAgICBsZXQgbGlzdCA9IFtdXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShmbGFncykgfHwgdHlwZW9mIGZsYWdzICE9PSAnb2JqZWN0Jykge1xuICAgICAgbGlzdCA9IFtdLmNvbmNhdChmbGFncyB8fCBbXSlcbiAgICAgIGtleSA9ICcnXG4gICAgfSBlbHNlIGlmIChmbGFncy5hZGQpIHtcbiAgICAgIGxpc3QgPSBbXS5jb25jYXQoZmxhZ3MuYWRkIHx8IFtdKVxuICAgICAga2V5ID0gJysnXG4gICAgfSBlbHNlIGlmIChmbGFncy5zZXQpIHtcbiAgICAgIGtleSA9ICcnXG4gICAgICBsaXN0ID0gW10uY29uY2F0KGZsYWdzLnNldCB8fCBbXSlcbiAgICB9IGVsc2UgaWYgKGZsYWdzLnJlbW92ZSkge1xuICAgICAga2V5ID0gJy0nXG4gICAgICBsaXN0ID0gW10uY29uY2F0KGZsYWdzLnJlbW92ZSB8fCBbXSlcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU2V0dGluZyBmbGFncyBvbicsIHNlcXVlbmNlLCAnaW4nLCBwYXRoLCAnLi4uJylcbiAgICByZXR1cm4gdGhpcy5zdG9yZShwYXRoLCBzZXF1ZW5jZSwga2V5ICsgJ0ZMQUdTJywgbGlzdCwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIFNUT1JFIGNvbW1hbmRcbiAgICpcbiAgICogU1RPUkUgZGV0YWlsczpcbiAgICogICBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNTAxI3NlY3Rpb24tNi40LjZcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGggVGhlIHBhdGggZm9yIHRoZSBtYWlsYm94IHdoaWNoIHNob3VsZCBiZSBzZWxlY3RlZCBmb3IgdGhlIGNvbW1hbmQuIFNlbGVjdHMgbWFpbGJveCBpZiBuZWNlc3NhcnlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHNlcXVlbmNlIE1lc3NhZ2Ugc2VsZWN0b3Igd2hpY2ggdGhlIGZsYWcgY2hhbmdlIGlzIGFwcGxpZWQgdG9cbiAgICogQHBhcmFtIHtTdHJpbmd9IGFjdGlvbiBTVE9SRSBtZXRob2QgdG8gY2FsbCwgZWcgXCIrRkxBR1NcIlxuICAgKiBAcGFyYW0ge0FycmF5fSBmbGFnc1xuICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdIFF1ZXJ5IG1vZGlmaWVyc1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZX0gUHJvbWlzZSB3aXRoIHRoZSBhcnJheSBvZiBtYXRjaGluZyBzZXEuIG9yIHVpZCBudW1iZXJzXG4gICAqL1xuICBhc3luYyBzdG9yZSAocGF0aCwgc2VxdWVuY2UsIGFjdGlvbiwgZmxhZ3MsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSBidWlsZFNUT1JFQ29tbWFuZChzZXF1ZW5jZSwgYWN0aW9uLCBmbGFncywgb3B0aW9ucylcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZXhlYyhjb21tYW5kLCAnRkVUQ0gnLCB7XG4gICAgICBwcmVjaGVjazogKGN0eCkgPT4gdGhpcy5fc2hvdWxkU2VsZWN0TWFpbGJveChwYXRoLCBjdHgpID8gdGhpcy5zZWxlY3RNYWlsYm94KHBhdGgsIHsgY3R4IH0pIDogUHJvbWlzZS5yZXNvbHZlKClcbiAgICB9KVxuICAgIHJldHVybiBwYXJzZUZFVENIKHJlc3BvbnNlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgQVBQRU5EIGNvbW1hbmRcbiAgICpcbiAgICogQVBQRU5EIGRldGFpbHM6XG4gICAqICAgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzUwMSNzZWN0aW9uLTYuMy4xMVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gZGVzdGluYXRpb24gVGhlIG1haWxib3ggd2hlcmUgdG8gYXBwZW5kIHRoZSBtZXNzYWdlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlIFRoZSBtZXNzYWdlIHRvIGFwcGVuZFxuICAgKiBAcGFyYW0ge0FycmF5fSBvcHRpb25zLmZsYWdzIEFueSBmbGFncyB5b3Ugd2FudCB0byBzZXQgb24gdGhlIHVwbG9hZGVkIG1lc3NhZ2UuIERlZmF1bHRzIHRvIFtcXFNlZW5dLiAob3B0aW9uYWwpXG4gICAqIEByZXR1cm5zIHtQcm9taXNlfSBQcm9taXNlIHdpdGggdGhlIGFycmF5IG9mIG1hdGNoaW5nIHNlcS4gb3IgdWlkIG51bWJlcnNcbiAgICovXG4gIGFzeW5jIHVwbG9hZCAoZGVzdGluYXRpb24sIG1lc3NhZ2UsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGZsYWdzID0gcHJvcE9yKFsnXFxcXFNlZW4nXSwgJ2ZsYWdzJywgb3B0aW9ucykubWFwKHZhbHVlID0+ICh7IHR5cGU6ICdhdG9tJywgdmFsdWUgfSkpXG4gICAgY29uc3QgY29tbWFuZCA9IHtcbiAgICAgIGNvbW1hbmQ6ICdBUFBFTkQnLFxuICAgICAgYXR0cmlidXRlczogW1xuICAgICAgICB7IHR5cGU6ICdhdG9tJywgdmFsdWU6IGRlc3RpbmF0aW9uIH0sXG4gICAgICAgIGZsYWdzLFxuICAgICAgICB7IHR5cGU6ICdsaXRlcmFsJywgdmFsdWU6IG1lc3NhZ2UgfVxuICAgICAgXVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdVcGxvYWRpbmcgbWVzc2FnZSB0bycsIGRlc3RpbmF0aW9uLCAnLi4uJylcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZXhlYyhjb21tYW5kKVxuICAgIHJldHVybiBwYXJzZUFQUEVORChyZXNwb25zZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIG1lc3NhZ2VzIGZyb20gYSBzZWxlY3RlZCBtYWlsYm94XG4gICAqXG4gICAqIEVYUFVOR0UgZGV0YWlsczpcbiAgICogICBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNTAxI3NlY3Rpb24tNi40LjNcbiAgICogVUlEIEVYUFVOR0UgZGV0YWlsczpcbiAgICogICBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNDMxNSNzZWN0aW9uLTIuMVxuICAgKlxuICAgKiBJZiBwb3NzaWJsZSAoYnlVaWQ6dHJ1ZSBhbmQgVUlEUExVUyBleHRlbnNpb24gc3VwcG9ydGVkKSwgdXNlcyBVSUQgRVhQVU5HRVxuICAgKiBjb21tYW5kIHRvIGRlbGV0ZSBhIHJhbmdlIG9mIG1lc3NhZ2VzLCBvdGhlcndpc2UgZmFsbHMgYmFjayB0byBFWFBVTkdFLlxuICAgKlxuICAgKiBOQiEgVGhpcyBtZXRob2QgbWlnaHQgYmUgZGVzdHJ1Y3RpdmUgLSBpZiBFWFBVTkdFIGlzIHVzZWQsIHRoZW4gYW55IG1lc3NhZ2VzXG4gICAqIHdpdGggXFxEZWxldGVkIGZsYWcgc2V0IGFyZSBkZWxldGVkXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoIFRoZSBwYXRoIGZvciB0aGUgbWFpbGJveCB3aGljaCBzaG91bGQgYmUgc2VsZWN0ZWQgZm9yIHRoZSBjb21tYW5kLiBTZWxlY3RzIG1haWxib3ggaWYgbmVjZXNzYXJ5XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzZXF1ZW5jZSBNZXNzYWdlIHJhbmdlIHRvIGJlIGRlbGV0ZWRcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSBRdWVyeSBtb2RpZmllcnNcbiAgICogQHJldHVybnMge1Byb21pc2V9IFByb21pc2VcbiAgICovXG4gIGFzeW5jIGRlbGV0ZU1lc3NhZ2VzIChwYXRoLCBzZXF1ZW5jZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgLy8gYWRkIFxcRGVsZXRlZCBmbGFnIHRvIHRoZSBtZXNzYWdlcyBhbmQgcnVuIEVYUFVOR0Ugb3IgVUlEIEVYUFVOR0VcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRGVsZXRpbmcgbWVzc2FnZXMnLCBzZXF1ZW5jZSwgJ2luJywgcGF0aCwgJy4uLicpXG4gICAgY29uc3QgdXNlVWlkUGx1cyA9IG9wdGlvbnMuYnlVaWQgJiYgdGhpcy5fY2FwYWJpbGl0eS5pbmRleE9mKCdVSURQTFVTJykgPj0gMFxuICAgIGNvbnN0IHVpZEV4cHVuZ2VDb21tYW5kID0geyBjb21tYW5kOiAnVUlEIEVYUFVOR0UnLCBhdHRyaWJ1dGVzOiBbeyB0eXBlOiAnc2VxdWVuY2UnLCB2YWx1ZTogc2VxdWVuY2UgfV0gfVxuICAgIGF3YWl0IHRoaXMuc2V0RmxhZ3MocGF0aCwgc2VxdWVuY2UsIHsgYWRkOiAnXFxcXERlbGV0ZWQnIH0sIG9wdGlvbnMpXG4gICAgY29uc3QgY21kID0gdXNlVWlkUGx1cyA/IHVpZEV4cHVuZ2VDb21tYW5kIDogJ0VYUFVOR0UnXG4gICAgcmV0dXJuIHRoaXMuZXhlYyhjbWQsIG51bGwsIHtcbiAgICAgIHByZWNoZWNrOiAoY3R4KSA9PiB0aGlzLl9zaG91bGRTZWxlY3RNYWlsYm94KHBhdGgsIGN0eCkgPyB0aGlzLnNlbGVjdE1haWxib3gocGF0aCwgeyBjdHggfSkgOiBQcm9taXNlLnJlc29sdmUoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGEgcmFuZ2Ugb2YgbWVzc2FnZXMgZnJvbSB0aGUgYWN0aXZlIG1haWxib3ggdG8gdGhlIGRlc3RpbmF0aW9uIG1haWxib3guXG4gICAqIFNpbGVudCBtZXRob2QgKHVubGVzcyBhbiBlcnJvciBvY2N1cnMpLCBieSBkZWZhdWx0IHJldHVybnMgbm8gaW5mb3JtYXRpb24uXG4gICAqXG4gICAqIENPUFkgZGV0YWlsczpcbiAgICogICBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNTAxI3NlY3Rpb24tNi40LjdcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGggVGhlIHBhdGggZm9yIHRoZSBtYWlsYm94IHdoaWNoIHNob3VsZCBiZSBzZWxlY3RlZCBmb3IgdGhlIGNvbW1hbmQuIFNlbGVjdHMgbWFpbGJveCBpZiBuZWNlc3NhcnlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHNlcXVlbmNlIE1lc3NhZ2UgcmFuZ2UgdG8gYmUgY29waWVkXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBkZXN0aW5hdGlvbiBEZXN0aW5hdGlvbiBtYWlsYm94IHBhdGhcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSBRdWVyeSBtb2RpZmllcnNcbiAgICogQHBhcmFtIHtCb29sZWFufSBbb3B0aW9ucy5ieVVpZF0gSWYgdHJ1ZSwgdXNlcyBVSUQgQ09QWSBpbnN0ZWFkIG9mIENPUFlcbiAgICogQHJldHVybnMge1Byb21pc2V9IFByb21pc2VcbiAgICovXG4gIGFzeW5jIGNvcHlNZXNzYWdlcyAocGF0aCwgc2VxdWVuY2UsIGRlc3RpbmF0aW9uLCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ29weWluZyBtZXNzYWdlcycsIHNlcXVlbmNlLCAnZnJvbScsIHBhdGgsICd0bycsIGRlc3RpbmF0aW9uLCAnLi4uJylcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZXhlYyh7XG4gICAgICBjb21tYW5kOiBvcHRpb25zLmJ5VWlkID8gJ1VJRCBDT1BZJyA6ICdDT1BZJyxcbiAgICAgIGF0dHJpYnV0ZXM6IFtcbiAgICAgICAgeyB0eXBlOiAnc2VxdWVuY2UnLCB2YWx1ZTogc2VxdWVuY2UgfSxcbiAgICAgICAgeyB0eXBlOiAnYXRvbScsIHZhbHVlOiBkZXN0aW5hdGlvbiB9XG4gICAgICBdXG4gICAgfSwgbnVsbCwge1xuICAgICAgcHJlY2hlY2s6IChjdHgpID0+IHRoaXMuX3Nob3VsZFNlbGVjdE1haWxib3gocGF0aCwgY3R4KSA/IHRoaXMuc2VsZWN0TWFpbGJveChwYXRoLCB7IGN0eCB9KSA6IFByb21pc2UucmVzb2x2ZSgpXG4gICAgfSlcbiAgICByZXR1cm4gcGFyc2VDT1BZKHJlc3BvbnNlKVxuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIGEgcmFuZ2Ugb2YgbWVzc2FnZXMgZnJvbSB0aGUgYWN0aXZlIG1haWxib3ggdG8gdGhlIGRlc3RpbmF0aW9uIG1haWxib3guXG4gICAqIFByZWZlcnMgdGhlIE1PVkUgZXh0ZW5zaW9uIGJ1dCBpZiBub3QgYXZhaWxhYmxlLCBmYWxscyBiYWNrIHRvXG4gICAqIENPUFkgKyBFWFBVTkdFXG4gICAqXG4gICAqIE1PVkUgZGV0YWlsczpcbiAgICogICBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmM2ODUxXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoIFRoZSBwYXRoIGZvciB0aGUgbWFpbGJveCB3aGljaCBzaG91bGQgYmUgc2VsZWN0ZWQgZm9yIHRoZSBjb21tYW5kLiBTZWxlY3RzIG1haWxib3ggaWYgbmVjZXNzYXJ5XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzZXF1ZW5jZSBNZXNzYWdlIHJhbmdlIHRvIGJlIG1vdmVkXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBkZXN0aW5hdGlvbiBEZXN0aW5hdGlvbiBtYWlsYm94IHBhdGhcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSBRdWVyeSBtb2RpZmllcnNcbiAgICogQHJldHVybnMge1Byb21pc2V9IFByb21pc2VcbiAgICovXG4gIGFzeW5jIG1vdmVNZXNzYWdlcyAocGF0aCwgc2VxdWVuY2UsIGRlc3RpbmF0aW9uLCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTW92aW5nIG1lc3NhZ2VzJywgc2VxdWVuY2UsICdmcm9tJywgcGF0aCwgJ3RvJywgZGVzdGluYXRpb24sICcuLi4nKVxuXG4gICAgaWYgKHRoaXMuX2NhcGFiaWxpdHkuaW5kZXhPZignTU9WRScpID09PSAtMSkge1xuICAgICAgLy8gRmFsbGJhY2sgdG8gQ09QWSArIEVYUFVOR0VcbiAgICAgIGF3YWl0IHRoaXMuY29weU1lc3NhZ2VzKHBhdGgsIHNlcXVlbmNlLCBkZXN0aW5hdGlvbiwgb3B0aW9ucylcbiAgICAgIHJldHVybiB0aGlzLmRlbGV0ZU1lc3NhZ2VzKHBhdGgsIHNlcXVlbmNlLCBvcHRpb25zKVxuICAgIH1cblxuICAgIC8vIElmIHBvc3NpYmxlLCB1c2UgTU9WRVxuICAgIHJldHVybiB0aGlzLmV4ZWMoe1xuICAgICAgY29tbWFuZDogb3B0aW9ucy5ieVVpZCA/ICdVSUQgTU9WRScgOiAnTU9WRScsXG4gICAgICBhdHRyaWJ1dGVzOiBbXG4gICAgICAgIHsgdHlwZTogJ3NlcXVlbmNlJywgdmFsdWU6IHNlcXVlbmNlIH0sXG4gICAgICAgIHsgdHlwZTogJ2F0b20nLCB2YWx1ZTogZGVzdGluYXRpb24gfVxuICAgICAgXVxuICAgIH0sIFsnT0snXSwge1xuICAgICAgcHJlY2hlY2s6IChjdHgpID0+IHRoaXMuX3Nob3VsZFNlbGVjdE1haWxib3gocGF0aCwgY3R4KSA/IHRoaXMuc2VsZWN0TWFpbGJveChwYXRoLCB7IGN0eCB9KSA6IFByb21pc2UucmVzb2x2ZSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIENPTVBSRVNTIGNvbW1hbmRcbiAgICpcbiAgICogQ09NUFJFU1MgZGV0YWlsczpcbiAgICogICBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNDk3OFxuICAgKi9cbiAgYXN5bmMgY29tcHJlc3NDb25uZWN0aW9uICgpIHtcbiAgICBpZiAoIXRoaXMuX2VuYWJsZUNvbXByZXNzaW9uIHx8IHRoaXMuX2NhcGFiaWxpdHkuaW5kZXhPZignQ09NUFJFU1M9REVGTEFURScpIDwgMCB8fCB0aGlzLmNsaWVudC5jb21wcmVzc2VkKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRW5hYmxpbmcgY29tcHJlc3Npb24uLi4nKVxuICAgIGF3YWl0IHRoaXMuZXhlYyh7XG4gICAgICBjb21tYW5kOiAnQ09NUFJFU1MnLFxuICAgICAgYXR0cmlidXRlczogW3tcbiAgICAgICAgdHlwZTogJ0FUT00nLFxuICAgICAgICB2YWx1ZTogJ0RFRkxBVEUnXG4gICAgICB9XVxuICAgIH0pXG4gICAgdGhpcy5jbGllbnQuZW5hYmxlQ29tcHJlc3Npb24oKVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDb21wcmVzc2lvbiBlbmFibGVkLCBhbGwgZGF0YSBzZW50IGFuZCByZWNlaXZlZCBpcyBkZWZsYXRlZCEnKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgTE9HSU4gb3IgQVVUSEVOVElDQVRFIFhPQVVUSDIgY29tbWFuZFxuICAgKlxuICAgKiBMT0dJTiBkZXRhaWxzOlxuICAgKiAgIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM1MDEjc2VjdGlvbi02LjIuM1xuICAgKiBYT0FVVEgyIGRldGFpbHM6XG4gICAqICAgaHR0cHM6Ly9kZXZlbG9wZXJzLmdvb2dsZS5jb20vZ21haWwveG9hdXRoMl9wcm90b2NvbCNpbWFwX3Byb3RvY29sX2V4Y2hhbmdlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBhdXRoLnVzZXJcbiAgICogQHBhcmFtIHtTdHJpbmd9IGF1dGgucGFzc1xuICAgKiBAcGFyYW0ge1N0cmluZ30gYXV0aC54b2F1dGgyXG4gICAqL1xuICBhc3luYyBsb2dpbiAoYXV0aCkge1xuICAgIGxldCBjb21tYW5kXG4gICAgY29uc3Qgb3B0aW9ucyA9IHt9XG5cbiAgICBpZiAoIWF1dGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQXV0aGVudGljYXRpb24gaW5mb3JtYXRpb24gbm90IHByb3ZpZGVkJylcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fY2FwYWJpbGl0eS5pbmRleE9mKCdBVVRIPVhPQVVUSDInKSA+PSAwICYmIGF1dGggJiYgYXV0aC54b2F1dGgyKSB7XG4gICAgICBjb21tYW5kID0ge1xuICAgICAgICBjb21tYW5kOiAnQVVUSEVOVElDQVRFJyxcbiAgICAgICAgYXR0cmlidXRlczogW1xuICAgICAgICAgIHsgdHlwZTogJ0FUT00nLCB2YWx1ZTogJ1hPQVVUSDInIH0sXG4gICAgICAgICAgeyB0eXBlOiAnQVRPTScsIHZhbHVlOiBidWlsZFhPQXV0aDJUb2tlbihhdXRoLnVzZXIsIGF1dGgueG9hdXRoMiksIHNlbnNpdGl2ZTogdHJ1ZSB9XG4gICAgICAgIF1cbiAgICAgIH1cblxuICAgICAgb3B0aW9ucy5lcnJvclJlc3BvbnNlRXhwZWN0c0VtcHR5TGluZSA9IHRydWUgLy8gKyB0YWdnZWQgZXJyb3IgcmVzcG9uc2UgZXhwZWN0cyBhbiBlbXB0eSBsaW5lIGluIHJldHVyblxuICAgIH0gZWxzZSB7XG4gICAgICBjb21tYW5kID0ge1xuICAgICAgICBjb21tYW5kOiAnbG9naW4nLFxuICAgICAgICBhdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgeyB0eXBlOiAnU1RSSU5HJywgdmFsdWU6IGF1dGgudXNlciB8fCAnJyB9LFxuICAgICAgICAgIHsgdHlwZTogJ1NUUklORycsIHZhbHVlOiBhdXRoLnBhc3MgfHwgJycsIHNlbnNpdGl2ZTogdHJ1ZSB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTG9nZ2luZyBpbi4uLicpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmV4ZWMoY29tbWFuZCwgJ2NhcGFiaWxpdHknLCBvcHRpb25zKVxuICAgIC8qXG4gICAgICogdXBkYXRlIHBvc3QtYXV0aCBjYXBhYmlsaXRlc1xuICAgICAqIGNhcGFiaWxpdHkgbGlzdCBzaG91bGRuJ3QgY29udGFpbiBhdXRoIHJlbGF0ZWQgc3R1ZmYgYW55bW9yZVxuICAgICAqIGJ1dCBzb21lIG5ldyBleHRlbnNpb25zIG1pZ2h0IGhhdmUgcG9wcGVkIHVwIHRoYXQgZG8gbm90XG4gICAgICogbWFrZSBtdWNoIHNlbnNlIGluIHRoZSBub24tYXV0aCBzdGF0ZVxuICAgICAqL1xuICAgIGlmIChyZXNwb25zZS5jYXBhYmlsaXR5ICYmIHJlc3BvbnNlLmNhcGFiaWxpdHkubGVuZ3RoKSB7XG4gICAgICAvLyBjYXBhYmlsaXRlcyB3ZXJlIGxpc3RlZCB3aXRoIHRoZSBPSyBbQ0FQQUJJTElUWSAuLi5dIHJlc3BvbnNlXG4gICAgICB0aGlzLl9jYXBhYmlsaXR5ID0gcmVzcG9uc2UuY2FwYWJpbGl0eVxuICAgIH0gZWxzZSBpZiAocmVzcG9uc2UucGF5bG9hZCAmJiByZXNwb25zZS5wYXlsb2FkLkNBUEFCSUxJVFkgJiYgcmVzcG9uc2UucGF5bG9hZC5DQVBBQklMSVRZLmxlbmd0aCkge1xuICAgICAgLy8gY2FwYWJpbGl0ZXMgd2VyZSBsaXN0ZWQgd2l0aCAqIENBUEFCSUxJVFkgLi4uIHJlc3BvbnNlXG4gICAgICB0aGlzLl9jYXBhYmlsaXR5ID0gcmVzcG9uc2UucGF5bG9hZC5DQVBBQklMSVRZLnBvcCgpLmF0dHJpYnV0ZXMubWFwKChjYXBhID0gJycpID0+IGNhcGEudmFsdWUudG9VcHBlckNhc2UoKS50cmltKCkpXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGNhcGFiaWxpdGllcyB3ZXJlIG5vdCBhdXRvbWF0aWNhbGx5IGxpc3RlZCwgcmVsb2FkXG4gICAgICBhd2FpdCB0aGlzLnVwZGF0ZUNhcGFiaWxpdHkodHJ1ZSlcbiAgICB9XG5cbiAgICB0aGlzLl9jaGFuZ2VTdGF0ZShTVEFURV9BVVRIRU5USUNBVEVEKVxuICAgIHRoaXMuX2F1dGhlbnRpY2F0ZWQgPSB0cnVlXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ0xvZ2luIHN1Y2Nlc3NmdWwsIHBvc3QtYXV0aCBjYXBhYmlsaXRlcyB1cGRhdGVkIScsIHRoaXMuX2NhcGFiaWxpdHkpXG4gIH1cblxuICAvKipcbiAgICogUnVuIGFuIElNQVAgY29tbWFuZC5cbiAgICpcbiAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgU3RydWN0dXJlZCByZXF1ZXN0IG9iamVjdFxuICAgKiBAcGFyYW0ge0FycmF5fSBhY2NlcHRVbnRhZ2dlZCBhIGxpc3Qgb2YgdW50YWdnZWQgcmVzcG9uc2VzIHRoYXQgd2lsbCBiZSBpbmNsdWRlZCBpbiAncGF5bG9hZCcgcHJvcGVydHlcbiAgICovXG4gIGFzeW5jIGV4ZWMgKHJlcXVlc3QsIGFjY2VwdFVudGFnZ2VkLCBvcHRpb25zKSB7XG4gICAgdGhpcy5icmVha0lkbGUoKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnQuZW5xdWV1ZUNvbW1hbmQocmVxdWVzdCwgYWNjZXB0VW50YWdnZWQsIG9wdGlvbnMpXG4gICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLmNhcGFiaWxpdHkpIHtcbiAgICAgIHRoaXMuX2NhcGFiaWxpdHkgPSByZXNwb25zZS5jYXBhYmlsaXR5XG4gICAgfVxuICAgIHJldHVybiByZXNwb25zZVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBjb25uZWN0aW9uIGlzIGlkbGluZy4gU2VuZHMgYSBOT09QIG9yIElETEUgY29tbWFuZFxuICAgKlxuICAgKiBJRExFIGRldGFpbHM6XG4gICAqICAgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzIxNzdcbiAgICovXG4gIGVudGVySWRsZSAoKSB7XG4gICAgaWYgKHRoaXMuX2VudGVyZWRJZGxlKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgY29uc3Qgc3VwcG9ydHNJZGxlID0gdGhpcy5fY2FwYWJpbGl0eS5pbmRleE9mKCdJRExFJykgPj0gMFxuICAgIHRoaXMuX2VudGVyZWRJZGxlID0gc3VwcG9ydHNJZGxlICYmIHRoaXMuX3NlbGVjdGVkTWFpbGJveCA/ICdJRExFJyA6ICdOT09QJ1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdFbnRlcmluZyBpZGxlIHdpdGggJyArIHRoaXMuX2VudGVyZWRJZGxlKVxuXG4gICAgaWYgKHRoaXMuX2VudGVyZWRJZGxlID09PSAnTk9PUCcpIHtcbiAgICAgIHRoaXMuX2lkbGVUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTZW5kaW5nIE5PT1AnKVxuICAgICAgICB0aGlzLmV4ZWMoJ05PT1AnKVxuICAgICAgfSwgdGhpcy50aW1lb3V0Tm9vcClcbiAgICB9IGVsc2UgaWYgKHRoaXMuX2VudGVyZWRJZGxlID09PSAnSURMRScpIHtcbiAgICAgIHRoaXMuY2xpZW50LmVucXVldWVDb21tYW5kKHtcbiAgICAgICAgY29tbWFuZDogJ0lETEUnXG4gICAgICB9KVxuICAgICAgdGhpcy5faWRsZVRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5jbGllbnQuc2VuZCgnRE9ORVxcclxcbicpXG4gICAgICAgIHRoaXMuX2VudGVyZWRJZGxlID0gZmFsc2VcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0lkbGUgdGVybWluYXRlZCcpXG4gICAgICB9LCB0aGlzLnRpbWVvdXRJZGxlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9wcyBhY3Rpb25zIHJlbGF0ZWQgaWRsaW5nLCBpZiBJRExFIGlzIHN1cHBvcnRlZCwgc2VuZHMgRE9ORSB0byBzdG9wIGl0XG4gICAqL1xuICBicmVha0lkbGUgKCkge1xuICAgIGlmICghdGhpcy5fZW50ZXJlZElkbGUpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNsZWFyVGltZW91dCh0aGlzLl9pZGxlVGltZW91dClcbiAgICBpZiAodGhpcy5fZW50ZXJlZElkbGUgPT09ICdJRExFJykge1xuICAgICAgdGhpcy5jbGllbnQuc2VuZCgnRE9ORVxcclxcbicpXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnSWRsZSB0ZXJtaW5hdGVkJylcbiAgICB9XG4gICAgdGhpcy5fZW50ZXJlZElkbGUgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgU1RBUlRUTFMgY29tbWFuZCBpZiBuZWVkZWRcbiAgICpcbiAgICogU1RBUlRUTFMgZGV0YWlsczpcbiAgICogICBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNTAxI3NlY3Rpb24tNi4yLjFcbiAgICpcbiAgICogQHBhcmFtIHtCb29sZWFufSBbZm9yY2VkXSBCeSBkZWZhdWx0IHRoZSBjb21tYW5kIGlzIG5vdCBydW4gaWYgY2FwYWJpbGl0eSBpcyBhbHJlYWR5IGxpc3RlZC4gU2V0IHRvIHRydWUgdG8gc2tpcCB0aGlzIHZhbGlkYXRpb25cbiAgICovXG4gIGFzeW5jIHVwZ3JhZGVDb25uZWN0aW9uICgpIHtcbiAgICAvLyBza2lwIHJlcXVlc3QsIGlmIGFscmVhZHkgc2VjdXJlZFxuICAgIGlmICh0aGlzLmNsaWVudC5zZWN1cmVNb2RlKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICAvLyBza2lwIGlmIFNUQVJUVExTIG5vdCBhdmFpbGFibGUgb3Igc3RhcnR0bHMgc3VwcG9ydCBkaXNhYmxlZFxuICAgIGlmICgodGhpcy5fY2FwYWJpbGl0eS5pbmRleE9mKCdTVEFSVFRMUycpIDwgMCB8fCB0aGlzLl9pZ25vcmVUTFMpICYmICF0aGlzLl9yZXF1aXJlVExTKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRW5jcnlwdGluZyBjb25uZWN0aW9uLi4uJylcbiAgICBhd2FpdCB0aGlzLmV4ZWMoJ1NUQVJUVExTJylcbiAgICB0aGlzLl9jYXBhYmlsaXR5ID0gW11cbiAgICB0aGlzLmNsaWVudC51cGdyYWRlKClcbiAgICByZXR1cm4gdGhpcy51cGRhdGVDYXBhYmlsaXR5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIENBUEFCSUxJVFkgY29tbWFuZFxuICAgKlxuICAgKiBDQVBBQklMSVRZIGRldGFpbHM6XG4gICAqICAgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzUwMSNzZWN0aW9uLTYuMS4xXG4gICAqXG4gICAqIERvZXNuJ3QgcmVnaXN0ZXIgdW50YWdnZWQgQ0FQQUJJTElUWSBoYW5kbGVyIGFzIHRoaXMgaXMgYWxyZWFkeVxuICAgKiBoYW5kbGVkIGJ5IGdsb2JhbCBoYW5kbGVyXG4gICAqXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gW2ZvcmNlZF0gQnkgZGVmYXVsdCB0aGUgY29tbWFuZCBpcyBub3QgcnVuIGlmIGNhcGFiaWxpdHkgaXMgYWxyZWFkeSBsaXN0ZWQuIFNldCB0byB0cnVlIHRvIHNraXAgdGhpcyB2YWxpZGF0aW9uXG4gICAqL1xuICBhc3luYyB1cGRhdGVDYXBhYmlsaXR5IChmb3JjZWQpIHtcbiAgICAvLyBza2lwIHJlcXVlc3QsIGlmIG5vdCBmb3JjZWQgdXBkYXRlIGFuZCBjYXBhYmlsaXRpZXMgYXJlIGFscmVhZHkgbG9hZGVkXG4gICAgaWYgKCFmb3JjZWQgJiYgdGhpcy5fY2FwYWJpbGl0eS5sZW5ndGgpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIElmIFNUQVJUVExTIGlzIHJlcXVpcmVkIHRoZW4gc2tpcCBjYXBhYmlsaXR5IGxpc3RpbmcgYXMgd2UgYXJlIGdvaW5nIHRvIHRyeVxuICAgIC8vIFNUQVJUVExTIGFueXdheSBhbmQgd2UgcmUtY2hlY2sgY2FwYWJpbGl0aWVzIGFmdGVyIGNvbm5lY3Rpb24gaXMgc2VjdXJlZFxuICAgIGlmICghdGhpcy5jbGllbnQuc2VjdXJlTW9kZSAmJiB0aGlzLl9yZXF1aXJlVExTKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnVXBkYXRpbmcgY2FwYWJpbGl0eS4uLicpXG4gICAgcmV0dXJuIHRoaXMuZXhlYygnQ0FQQUJJTElUWScpXG4gIH1cblxuICBoYXNDYXBhYmlsaXR5IChjYXBhID0gJycpIHtcbiAgICByZXR1cm4gdGhpcy5fY2FwYWJpbGl0eS5pbmRleE9mKGNhcGEudG9VcHBlckNhc2UoKS50cmltKCkpID49IDBcbiAgfVxuXG4gIC8vIERlZmF1bHQgaGFuZGxlcnMgZm9yIHVudGFnZ2VkIHJlc3BvbnNlc1xuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYW4gdW50YWdnZWQgT0sgaW5jbHVkZXMgW0NBUEFCSUxJVFldIHRhZyBhbmQgdXBkYXRlcyBjYXBhYmlsaXR5IG9iamVjdFxuICAgKlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVzcG9uc2UgUGFyc2VkIHNlcnZlciByZXNwb25zZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBuZXh0IFVudGlsIGNhbGxlZCwgc2VydmVyIHJlc3BvbnNlcyBhcmUgbm90IHByb2Nlc3NlZFxuICAgKi9cbiAgX3VudGFnZ2VkT2tIYW5kbGVyIChyZXNwb25zZSkge1xuICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5jYXBhYmlsaXR5KSB7XG4gICAgICB0aGlzLl9jYXBhYmlsaXR5ID0gcmVzcG9uc2UuY2FwYWJpbGl0eVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGVzIGNhcGFiaWxpdHkgb2JqZWN0XG4gICAqXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXNwb25zZSBQYXJzZWQgc2VydmVyIHJlc3BvbnNlXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG5leHQgVW50aWwgY2FsbGVkLCBzZXJ2ZXIgcmVzcG9uc2VzIGFyZSBub3QgcHJvY2Vzc2VkXG4gICAqL1xuICBfdW50YWdnZWRDYXBhYmlsaXR5SGFuZGxlciAocmVzcG9uc2UpIHtcbiAgICB0aGlzLl9jYXBhYmlsaXR5ID0gcGlwZShcbiAgICAgIHByb3BPcihbXSwgJ2F0dHJpYnV0ZXMnKSxcbiAgICAgIG1hcCgoeyB2YWx1ZSB9KSA9PiAodmFsdWUgfHwgJycpLnRvVXBwZXJDYXNlKCkudHJpbSgpKVxuICAgICkocmVzcG9uc2UpXG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlcyBleGlzdGluZyBtZXNzYWdlIGNvdW50XG4gICAqXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXNwb25zZSBQYXJzZWQgc2VydmVyIHJlc3BvbnNlXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG5leHQgVW50aWwgY2FsbGVkLCBzZXJ2ZXIgcmVzcG9uc2VzIGFyZSBub3QgcHJvY2Vzc2VkXG4gICAqL1xuICBfdW50YWdnZWRFeGlzdHNIYW5kbGVyIChyZXNwb25zZSkge1xuICAgIGlmIChyZXNwb25zZSAmJiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocmVzcG9uc2UsICducicpKSB7XG4gICAgICB0aGlzLm9udXBkYXRlICYmIHRoaXMub251cGRhdGUodGhpcy5fc2VsZWN0ZWRNYWlsYm94LCAnZXhpc3RzJywgcmVzcG9uc2UubnIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluZGljYXRlcyBhIG1lc3NhZ2UgaGFzIGJlZW4gZGVsZXRlZFxuICAgKlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVzcG9uc2UgUGFyc2VkIHNlcnZlciByZXNwb25zZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBuZXh0IFVudGlsIGNhbGxlZCwgc2VydmVyIHJlc3BvbnNlcyBhcmUgbm90IHByb2Nlc3NlZFxuICAgKi9cbiAgX3VudGFnZ2VkRXhwdW5nZUhhbmRsZXIgKHJlc3BvbnNlKSB7XG4gICAgaWYgKHJlc3BvbnNlICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChyZXNwb25zZSwgJ25yJykpIHtcbiAgICAgIHRoaXMub251cGRhdGUgJiYgdGhpcy5vbnVwZGF0ZSh0aGlzLl9zZWxlY3RlZE1haWxib3gsICdleHB1bmdlJywgcmVzcG9uc2UubnIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluZGljYXRlcyB0aGF0IGZsYWdzIGhhdmUgYmVlbiB1cGRhdGVkIGZvciBhIG1lc3NhZ2VcbiAgICpcbiAgICogQHBhcmFtIHtPYmplY3R9IHJlc3BvbnNlIFBhcnNlZCBzZXJ2ZXIgcmVzcG9uc2VcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbmV4dCBVbnRpbCBjYWxsZWQsIHNlcnZlciByZXNwb25zZXMgYXJlIG5vdCBwcm9jZXNzZWRcbiAgICovXG4gIF91bnRhZ2dlZEZldGNoSGFuZGxlciAocmVzcG9uc2UpIHtcbiAgICB0aGlzLm9udXBkYXRlICYmIHRoaXMub251cGRhdGUodGhpcy5fc2VsZWN0ZWRNYWlsYm94LCAnZmV0Y2gnLCBbXS5jb25jYXQocGFyc2VGRVRDSCh7IHBheWxvYWQ6IHsgRkVUQ0g6IFtyZXNwb25zZV0gfSB9KSB8fCBbXSkuc2hpZnQoKSlcbiAgfVxuXG4gIC8vIFByaXZhdGUgaGVscGVyc1xuXG4gIC8qKlxuICAgKiBJbmRpY2F0ZXMgdGhhdCB0aGUgY29ubmVjdGlvbiBzdGFydGVkIGlkbGluZy4gSW5pdGlhdGVzIGEgY3ljbGVcbiAgICogb2YgTk9PUHMgb3IgSURMRXMgdG8gcmVjZWl2ZSBub3RpZmljYXRpb25zIGFib3V0IHVwZGF0ZXMgaW4gdGhlIHNlcnZlclxuICAgKi9cbiAgX29uSWRsZSAoKSB7XG4gICAgaWYgKCF0aGlzLl9hdXRoZW50aWNhdGVkIHx8IHRoaXMuX2VudGVyZWRJZGxlKSB7XG4gICAgICAvLyBObyBuZWVkIHRvIElETEUgd2hlbiBub3QgbG9nZ2VkIGluIG9yIGFscmVhZHkgaWRsaW5nXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ2xpZW50IHN0YXJ0ZWQgaWRsaW5nJylcbiAgICB0aGlzLmVudGVySWRsZSgpXG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlcyB0aGUgSU1BUCBzdGF0ZSB2YWx1ZSBmb3IgdGhlIGN1cnJlbnQgY29ubmVjdGlvblxuICAgKlxuICAgKiBAcGFyYW0ge051bWJlcn0gbmV3U3RhdGUgVGhlIHN0YXRlIHlvdSB3YW50IHRvIGNoYW5nZSB0b1xuICAgKi9cbiAgX2NoYW5nZVN0YXRlIChuZXdTdGF0ZSkge1xuICAgIGlmIChuZXdTdGF0ZSA9PT0gdGhpcy5fc3RhdGUpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdFbnRlcmluZyBzdGF0ZTogJyArIG5ld1N0YXRlKVxuXG4gICAgLy8gaWYgYSBtYWlsYm94IHdhcyBvcGVuZWQsIGVtaXQgb25jbG9zZW1haWxib3ggYW5kIGNsZWFyIHNlbGVjdGVkTWFpbGJveCB2YWx1ZVxuICAgIGlmICh0aGlzLl9zdGF0ZSA9PT0gU1RBVEVfU0VMRUNURUQgJiYgdGhpcy5fc2VsZWN0ZWRNYWlsYm94KSB7XG4gICAgICB0aGlzLm9uY2xvc2VtYWlsYm94ICYmIHRoaXMub25jbG9zZW1haWxib3godGhpcy5fc2VsZWN0ZWRNYWlsYm94KVxuICAgICAgdGhpcy5fc2VsZWN0ZWRNYWlsYm94ID0gZmFsc2VcbiAgICB9XG5cbiAgICB0aGlzLl9zdGF0ZSA9IG5ld1N0YXRlXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBhIHBhdGggZXhpc3RzIGluIHRoZSBNYWlsYm94IHRyZWVcbiAgICpcbiAgICogQHBhcmFtIHtPYmplY3R9IHRyZWUgTWFpbGJveCB0cmVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBkZWxpbWl0ZXJcbiAgICogQHJldHVybiB7T2JqZWN0fSBicmFuY2ggZm9yIHVzZWQgcGF0aFxuICAgKi9cbiAgX2Vuc3VyZVBhdGggKHRyZWUsIHBhdGgsIGRlbGltaXRlcikge1xuICAgIGNvbnN0IG5hbWVzID0gcGF0aC5zcGxpdChkZWxpbWl0ZXIpXG4gICAgbGV0IGJyYW5jaCA9IHRyZWVcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbmFtZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGxldCBmb3VuZCA9IGZhbHNlXG4gICAgICBmb3IgKGxldCBqID0gMDsgaiA8IGJyYW5jaC5jaGlsZHJlbi5sZW5ndGg7IGorKykge1xuICAgICAgICBpZiAodGhpcy5fY29tcGFyZU1haWxib3hOYW1lcyhicmFuY2guY2hpbGRyZW5bal0ubmFtZSwgaW1hcERlY29kZShuYW1lc1tpXSkpKSB7XG4gICAgICAgICAgYnJhbmNoID0gYnJhbmNoLmNoaWxkcmVuW2pdXG4gICAgICAgICAgZm91bmQgPSB0cnVlXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKCFmb3VuZCkge1xuICAgICAgICBicmFuY2guY2hpbGRyZW4ucHVzaCh7XG4gICAgICAgICAgbmFtZTogaW1hcERlY29kZShuYW1lc1tpXSksXG4gICAgICAgICAgZGVsaW1pdGVyOiBkZWxpbWl0ZXIsXG4gICAgICAgICAgcGF0aDogbmFtZXMuc2xpY2UoMCwgaSArIDEpLmpvaW4oZGVsaW1pdGVyKSxcbiAgICAgICAgICBjaGlsZHJlbjogW11cbiAgICAgICAgfSlcbiAgICAgICAgYnJhbmNoID0gYnJhbmNoLmNoaWxkcmVuW2JyYW5jaC5jaGlsZHJlbi5sZW5ndGggLSAxXVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gYnJhbmNoXG4gIH1cblxuICAvKipcbiAgICogQ29tcGFyZXMgdHdvIG1haWxib3ggbmFtZXMuIENhc2UgaW5zZW5zaXRpdmUgaW4gY2FzZSBvZiBJTkJPWCwgb3RoZXJ3aXNlIGNhc2Ugc2Vuc2l0aXZlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBhIE1haWxib3ggbmFtZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gYiBNYWlsYm94IG5hbWVcbiAgICogQHJldHVybnMge0Jvb2xlYW59IFRydWUgaWYgdGhlIGZvbGRlciBuYW1lcyBtYXRjaFxuICAgKi9cbiAgX2NvbXBhcmVNYWlsYm94TmFtZXMgKGEsIGIpIHtcbiAgICByZXR1cm4gKGEudG9VcHBlckNhc2UoKSA9PT0gJ0lOQk9YJyA/ICdJTkJPWCcgOiBhKSA9PT0gKGIudG9VcHBlckNhc2UoKSA9PT0gJ0lOQk9YJyA/ICdJTkJPWCcgOiBiKVxuICB9XG5cbiAgY3JlYXRlTG9nZ2VyIChjcmVhdG9yID0gY3JlYXRlRGVmYXVsdExvZ2dlcikge1xuICAgIGNvbnN0IGxvZ2dlciA9IGNyZWF0b3IoKHRoaXMuX2F1dGggfHwge30pLnVzZXIgfHwgJycsIHRoaXMuX2hvc3QpXG4gICAgdGhpcy5sb2dnZXIgPSB0aGlzLmNsaWVudC5sb2dnZXIgPSB7XG4gICAgICBkZWJ1ZzogKC4uLm1zZ3MpID0+IHsgaWYgKExPR19MRVZFTF9ERUJVRyA+PSB0aGlzLmxvZ0xldmVsKSB7IGxvZ2dlci5kZWJ1Zyhtc2dzKSB9IH0sXG4gICAgICBpbmZvOiAoLi4ubXNncykgPT4geyBpZiAoTE9HX0xFVkVMX0lORk8gPj0gdGhpcy5sb2dMZXZlbCkgeyBsb2dnZXIuaW5mbyhtc2dzKSB9IH0sXG4gICAgICB3YXJuOiAoLi4ubXNncykgPT4geyBpZiAoTE9HX0xFVkVMX1dBUk4gPj0gdGhpcy5sb2dMZXZlbCkgeyBsb2dnZXIud2Fybihtc2dzKSB9IH0sXG4gICAgICBlcnJvcjogKC4uLm1zZ3MpID0+IHsgaWYgKExPR19MRVZFTF9FUlJPUiA+PSB0aGlzLmxvZ0xldmVsKSB7IGxvZ2dlci5lcnJvcihtc2dzKSB9IH1cbiAgICB9XG4gIH1cbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsSUFBQUEsTUFBQSxHQUFBQyxPQUFBO0FBQ0EsSUFBQUMsV0FBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUsY0FBQSxHQUFBRixPQUFBO0FBU0EsSUFBQUcsZUFBQSxHQUFBSCxPQUFBO0FBT0EsSUFBQUksT0FBQSxHQUFBQyxzQkFBQSxDQUFBTCxPQUFBO0FBQ0EsSUFBQU0sS0FBQSxHQUFBRCxzQkFBQSxDQUFBTCxPQUFBO0FBQ0EsSUFBQU8sT0FBQSxHQUFBUCxPQUFBO0FBUUEsSUFBQVEsV0FBQSxHQUFBUixPQUFBO0FBRXNCLFNBQUFLLHVCQUFBSSxHQUFBLFdBQUFBLEdBQUEsSUFBQUEsR0FBQSxDQUFBQyxVQUFBLEdBQUFELEdBQUEsS0FBQUUsT0FBQSxFQUFBRixHQUFBO0FBQUEsU0FBQUcs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