/* eslint-disable no-unused-expressions */

import ImapClient from './imap'
import { toTypedArray } from './common'

const host = 'localhost'
const port = 10000

describe('browserbox imap unit tests', () => {
  var client, socketStub

  /* jshint indent:false */

  beforeEach(() => {
    client = new ImapClient(host, port)
    expect(client).to.exist

    client.logger = {
      debug: () => { },
      error: () => { }
    }

    var Socket = function () { }
    Socket.open = () => { }
    Socket.prototype.close = () => { }
    Socket.prototype.send = () => { }
    Socket.prototype.suspend = () => { }
    Socket.prototype.resume = () => { }
    Socket.prototype.upgradeToSecure = () => { }

    socketStub = sinon.createStubInstance(Socket)
    sinon.stub(Socket, 'open').withArgs(host, port).returns(socketStub)

    var promise = client.connect(Socket).then(() => {
      expect(Socket.open.callCount).to.equal(1)

      expect(socketStub.onerror).to.exist
      expect(socketStub.onopen).to.exist
      expect(socketStub.onclose).to.exist
      expect(socketStub.ondata).to.exist
    })

    setTimeout(() => socketStub.onopen(), 10)

    return promise
  })

  describe.skip('#close', () => {
    it('should call socket.close', () => {
      client.socket.readyState = 'open'

      setTimeout(() => socketStub.onclose(), 10)
      return client.close().then(() => {
        expect(socketStub.close.callCount).to.equal(1)
      })
    })

    it('should not call socket.close', () => {
      client.socket.readyState = 'not open. duh.'

      setTimeout(() => socketStub.onclose(), 10)
      return client.close().then(() => {
        expect(socketStub.close.called).to.be.false
      })
    })
  })

  describe('#upgrade', () => {
    it('should upgrade socket', () => {
      client.secureMode = false
      client.upgrade()
    })

    it('should not upgrade socket', () => {
      client.secureMode = true
      client.upgrade()
    })
  })

  describe('#setHandler', () => {
    it('should set global handler for keyword', () => {
      var handler = () => { }
      client.setHandler('fetch', handler)

      expect(client._globalAcceptUntagged.FETCH).to.equal(handler)
    })
  })

  describe('#socket.onerror', () => {
    it('should emit error and close connection', (done) => {
      client.socket.onerror({
        data: new Error('err')
      })

      client.onerror = () => {
        done()
      }
    })
  })

  describe('#socket.onclose', () => {
    it('should emit error ', (done) => {
      client.socket.onclose()

      client.onerror = () => {
        done()
      }
    })
  })

  describe('#_onData', () => {
    it('should process input', () => {
      sinon.stub(client, '_parseIncomingCommands')
      sinon.stub(client, '_iterateIncomingBuffer')

      client._onData({
        data: toTypedArray('foobar').buffer
      })

      expect(client._parseIncomingCommands.calledOnce).to.be.true
      expect(client._iterateIncomingBuffer.calledOnce).to.be.true
    })
  })

  describe('rateIncomingBuffer', () => {
    it('should iterate chunked input', () => {
      appendIncomingBuffer('* 1 FETCH (UID 1)\r\n* 2 FETCH (UID 2)\r\n* 3 FETCH (UID 3)\r\n')
      var iterator = client._iterateIncomingBuffer()

      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 1 FETCH (UID 1)')
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 2 FETCH (UID 2)')
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 3 FETCH (UID 3)')
      expect(iterator.next().value).to.be.undefined
    })

    it('should process chunked literals', () => {
      appendIncomingBuffer('* 1 FETCH (UID {1}\r\n1)\r\n* 2 FETCH (UID {4}\r\n2345)\r\n* 3 FETCH (UID {4}\r\n3789)\r\n')
      var iterator = client._iterateIncomingBuffer()

      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 1 FETCH (UID {1}\r\n1)')
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 2 FETCH (UID {4}\r\n2345)')
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 3 FETCH (UID {4}\r\n3789)')
      expect(iterator.next().value).to.be.undefined
    })

    it('should process chunked literals 2', () => {
      appendIncomingBuffer('* 1 FETCH (UID 1)\r\n* 2 FETCH (UID {4}\r\n2345)\r\n')
      var iterator = client._iterateIncomingBuffer()

      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 1 FETCH (UID 1)')
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 2 FETCH (UID {4}\r\n2345)')
      expect(iterator.next().value).to.be.undefined
    })

    it('should process chunked literals 3', () => {
      appendIncomingBuffer('* 1 FETCH (UID {1}\r\n1)\r\n* 2 FETCH (UID 4)\r\n')
      var iterator = client._iterateIncomingBuffer()

      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 1 FETCH (UID {1}\r\n1)')
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 2 FETCH (UID 4)')
      expect(iterator.next().value).to.be.undefined
    })

    it('should process chunked literals 4', () => {
      appendIncomingBuffer('* SEARCH {1}\r\n1 {1}\r\n2\r\n')
      var iterator = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* SEARCH {1}\r\n1 {1}\r\n2')
    })

    it('should process CRLF literal', () => {
      appendIncomingBuffer('* 1 FETCH (UID 20 BODY[HEADER.FIELDS (REFERENCES LIST-ID)] {2}\r\n\r\n)\r\n')
      var iterator = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 1 FETCH (UID 20 BODY[HEADER.FIELDS (REFERENCES LIST-ID)] {2}\r\n\r\n)')
    })

    it('should process CRLF literal 2', () => {
      appendIncomingBuffer('* 1 FETCH (UID 1 ENVELOPE ("string with {parenthesis}") BODY[HEADER.FIELDS (REFERENCES LIST-ID)] {2}\r\n\r\n)\r\n')
      var iterator = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 1 FETCH (UID 1 ENVELOPE ("string with {parenthesis}") BODY[HEADER.FIELDS (REFERENCES LIST-ID)] {2}\r\n\r\n)')
    })

    it('should parse multiple zero-length literals', () => {
      appendIncomingBuffer('* 126015 FETCH (UID 585599 BODY[1.2] {0}\r\n BODY[1.1] {0}\r\n)\r\n')
      var iterator = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 126015 FETCH (UID 585599 BODY[1.2] {0}\r\n BODY[1.1] {0}\r\n)')
    })

    it('should process two commands when CRLF arrives in 2 parts', () => {
      appendIncomingBuffer('* 1 FETCH (UID 1)\r')
      var iterator1 = client._iterateIncomingBuffer()
      expect(iterator1.next().value).to.be.undefined

      appendIncomingBuffer('\n* 2 FETCH (UID 2)\r\n')
      var iterator2 = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator2.next().value)).to.equal('* 1 FETCH (UID 1)')
      expect(String.fromCharCode.apply(null, iterator2.next().value)).to.equal('* 2 FETCH (UID 2)')
      expect(iterator2.next().value).to.be.undefined
    })

    it('should process literal when literal count arrives in 2 parts', () => {
      appendIncomingBuffer('* 1 FETCH (UID {')
      var iterator1 = client._iterateIncomingBuffer()
      expect(iterator1.next().value).to.be.undefined

      appendIncomingBuffer('2}\r\n12)\r\n')
      var iterator2 = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator2.next().value)).to.equal('* 1 FETCH (UID {2}\r\n12)')
      expect(iterator2.next().value).to.be.undefined
    })

    it('should process literal when literal count arrives in 2 parts 2', () => {
      appendIncomingBuffer('* 1 FETCH (UID {1')
      var iterator1 = client._iterateIncomingBuffer()
      expect(iterator1.next().value).to.be.undefined

      appendIncomingBuffer('0}\r\n0123456789)\r\n')
      var iterator2 = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator2.next().value)).to.equal('* 1 FETCH (UID {10}\r\n0123456789)')
      expect(iterator2.next().value).to.be.undefined
    })

    it('should process literal when literal count arrives in 2 parts 3', () => {
      appendIncomingBuffer('* 1 FETCH (UID {')
      var iterator1 = client._iterateIncomingBuffer()
      expect(iterator1.next().value).to.be.undefined

      appendIncomingBuffer('10}\r\n1234567890)\r\n')
      var iterator2 = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator2.next().value)).to.equal('* 1 FETCH (UID {10}\r\n1234567890)')
      expect(iterator2.next().value).to.be.undefined
    })

    it('should process literal when literal count arrives in 2 parts 4', () => {
      appendIncomingBuffer('* 1 FETCH (UID 1 BODY[HEADER.FIELDS (REFERENCES LIST-ID)] {2}\r')
      var iterator1 = client._iterateIncomingBuffer()
      expect(iterator1.next().value).to.be.undefined
      appendIncomingBuffer('\nXX)\r\n')
      var iterator2 = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator2.next().value)).to.equal('* 1 FETCH (UID 1 BODY[HEADER.FIELDS (REFERENCES LIST-ID)] {2}\r\nXX)')
    })

    it('should process literal when literal count arrives in 3 parts', () => {
      appendIncomingBuffer('* 1 FETCH (UID {')
      var iterator1 = client._iterateIncomingBuffer()
      expect(iterator1.next().value).to.be.undefined

      appendIncomingBuffer('1')
      var iterator2 = client._iterateIncomingBuffer()
      expect(iterator2.next().value).to.be.undefined

      appendIncomingBuffer('}\r\n1)\r\n')
      var iterator3 = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator3.next().value)).to.equal('* 1 FETCH (UID {1}\r\n1)')
      expect(iterator3.next().value).to.be.undefined
    })

    it('should process SEARCH response when it arrives in 2 parts', () => {
      appendIncomingBuffer('* SEARCH 1 2')
      var iterator1 = client._iterateIncomingBuffer()
      expect(iterator1.next().value).to.be.undefined

      appendIncomingBuffer(' 3 4\r\n')
      var iterator2 = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator2.next().value)).to.equal('* SEARCH 1 2 3 4')
      expect(iterator2.next().value).to.be.undefined
    })

    it('should not process {} in string as literal 1', () => {
      appendIncomingBuffer('* 1 FETCH (UID 1 ENVELOPE ("string with {parenthesis}"))\r\n')
      var iterator = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 1 FETCH (UID 1 ENVELOPE ("string with {parenthesis}"))')
    })

    it('should not process {} in string as literal 2', () => {
      appendIncomingBuffer('* 1 FETCH (UID 1 ENVELOPE ("string with number in parenthesis {123}"))\r\n')
      var iterator = client._iterateIncomingBuffer()
      expect(String.fromCharCode.apply(null, iterator.next().value)).to.equal('* 1 FETCH (UID 1 ENVELOPE ("string with number in parenthesis {123}"))')
    })

    function appendIncomingBuffer (content) {
      client._incomingBuffers.push(toTypedArray(content))
    }
  })

  describe('#_parseIncomingCommands', () => {
    it('should process a tagged item from the queue', () => {
      client.onready = sinon.stub()
      sinon.stub(client, '_handleResponse')

      function * gen () { yield toTypedArray('OK Hello world!') }

      client._parseIncomingCommands(gen())

      expect(client.onready.callCount).to.equal(1)
      expect(client._handleResponse.withArgs({
        tag: 'OK',
        command: 'Hello',
        attributes: [{
          type: 'ATOM',
          value: 'world!'
        }]
      }).calledOnce).to.be.true
    })

    it('W1 NO unavailable with timestamp should be retried', () => {
      client.onready = sinon.stub()
      sinon.stub(client, '_handleResponse')

      function * gen () { yield toTypedArray('W1 NO [UNAVAILABLE] Temporary authentication failure. [2023-01-11 10:27:22]') }

      client._parseIncomingCommands(gen())

      expect(client.onready.callCount).to.equal(1)

      expect(client._handleResponse.withArgs({
        tag: 'W1',
        command: 'NO',
        attributes: [
          {
            type: 'ATOM',
            value: '',
            section: [
              {
                type: 'ATOM',
                value: 'UNAVAILABLE'
              }
            ]
          },
          {
            type: 'TEXT',
            value: 'Temporary authentication failure. [2023-01-11 10:27:22'
          }
        ],
        humanReadable: 'Temporary authentication failure. [2023-01-11 10:27:22',
        code: 'UNAVAILABLE'
      }).calledOnce).to.be.true
    })

    it('failing parsing due to double quotes should be retried', () => {
      client.onready = sinon.stub()
      sinon.stub(client, '_handleResponse')

      function * gen () { yield toTypedArray('* 20 FETCH (INTERNALDATE " 4-Jan-2021 17:05:45 +0000" ENVELOPE ("Mon, 04 Jan 2021 18:05:36 +0100" "message subject" ((NIL NIL ""testing" "testing.com"")) "<teting@teting.com>") FLAGS (\\Seen) RFC822.SIZE 73156 UID 20)') }

      client._parseIncomingCommands(gen())

      expect(client.onready.callCount).to.equal(1)

      expect(client._handleResponse.withArgs({
        tag: '*',
        command: 'FETCH',
        attributes: [
          [
            {
              type: 'ATOM',
              value: 'INTERNALDATE'
            },
            {
              type: 'STRING',
              value: ' 4-Jan-2021 17:05:45 +0000'
            },
            {
              type: 'ATOM',
              value: 'ENVELOPE'
            },
            [
              {
                type: 'STRING',
                value: 'Mon, 04 Jan 2021 18:05:36 +0100'
              },
              {
                type: 'STRING',
                value: 'message subject'
              },
              [
                [
                  null,
                  null,
                  {
                    type: 'STRING',
                    value: 'testing'
                  },
                  {
                    type: 'STRING',
                    value: 'testing.com'
                  }
                ]
              ],
              {
                type: 'STRING',
                value: '<teting@teting.com>'
              }
            ],
            {
              type: 'ATOM',
              value: 'FLAGS'
            },
            [
              {
                type: 'ATOM',
                value: '\\Seen'
              }
            ],
            {
              type: 'ATOM',
              value: 'RFC822.SIZE'
            },
            {
              type: 'ATOM',
              value: '73156'
            },
            {
              type: 'ATOM',
              value: 'UID'
            },
            {
              type: 'ATOM',
              value: '20'
            }
          ]
        ],
        nr: 20
      }).calledOnce).to.be.true
    })

    it('failed parsing due to encoded-words with double quotes should be retried', () => {
      client.onready = sinon.stub()
      sinon.stub(client, '_handleResponse')

      function * gen () { yield toTypedArray('* 36 FETCH (INTERNALDATE "13-Jan-2021 19:24:45 +0000" ENVELOPE ("Wed, 13 Jan 2021 20:24:41 +0100" "Testing email" (("=?utf-8?Q?"|_m=C3=BCller | testing.at"?=" NIL "co" "testing.at")) (("=?utf-8?Q?"|_fm=C3=BCller_|_testing.at"?=" NIL "co" "testing.at")) (("=?utf-8?Q?"|_fbm=C3=BCller_|_testing.at"?=" NIL "co" "testing.at")) ((NIL NIL "testing" "mailing.at")) ((NIL NIL NIL NIL)) ((NIL NIL NIL NIL)) ((NIL NIL NIL NIL)) "<uuid@testing.at>") FLAGS (\\Seen) RFC822.SIZE 31689 UID 36)') }

      client._parseIncomingCommands(gen())

      expect(client.onready.callCount).to.equal(1)

      expect(client._handleResponse.withArgs({
        tag: '*',
        command: 'FETCH',
        attributes: [
          [
            {
              type: 'ATOM',
              value: 'INTERNALDATE'
            },
            {
              type: 'STRING',
              value: '13-Jan-2021 19:24:45 +0000'
            },
            {
              type: 'ATOM',
              value: 'ENVELOPE'
            },
            [
              {
                type: 'STRING',
                value: 'Wed, 13 Jan 2021 20:24:41 +0100'
              },
              {
                type: 'STRING',
                value: 'Testing email'
              },
              [
                [
                  {
                    type: 'STRING',
                    value: '=?utf-8?Q?|_m=C3=BCller | testing.at?='
                  },
                  null,
                  {
                    type: 'STRING',
                    value: 'co'
                  },
                  {
                    type: 'STRING',
                    value: 'testing.at'
                  }
                ]
              ],
              [
                [
                  {
                    type: 'STRING',
                    value: '=?utf-8?Q?|_fm=C3=BCller_|_testing.at?='
                  },
                  null,
                  {
                    type: 'STRING',
                    value: 'co'
                  },
                  {
                    type: 'STRING',
                    value: 'testing.at'
                  }
                ]
              ],
              [
                [
                  {
                    type: 'STRING',
                    value: '=?utf-8?Q?|_fbm=C3=BCller_|_testing.at?='
                  },
                  null,
                  {
                    type: 'STRING',
                    value: 'co'
                  },
                  {
                    type: 'STRING',
                    value: 'testing.at'
                  }
                ]
              ],
              [
                [
                  null,
                  null,
                  {
                    type: 'STRING',
                    value: 'testing'
                  },
                  {
                    type: 'STRING',
                    value: 'mailing.at'
                  }
                ]
              ],
              [
                [
                  null,
                  null,
                  null,
                  null
                ]
              ],
              [
                [
                  null,
                  null,
                  null,
                  null
                ]
              ],
              [
                [
                  null,
                  null,
                  null,
                  null
                ]
              ],
              {
                type: 'STRING',
                value: '<uuid@testing.at>'
              }
            ],
            {
              type: 'ATOM',
              value: 'FLAGS'
            },
            [
              {
                type: 'ATOM',
                value: '\\Seen'
              }
            ],
            {
              type: 'ATOM',
              value: 'RFC822.SIZE'
            },
            {
              type: 'ATOM',
              value: '31689'
            },
            {
              type: 'ATOM',
              value: 'UID'
            },
            {
              type: 'ATOM',
              value: '36'
            }
          ]
        ],
        nr: 36
      }).calledOnce).to.be.true
    })

    it('failed parsing due to invalid formed serverbug should be retried', () => {
      client.onready = sinon.stub()
      sinon.stub(client, '_handleResponse')

      function * gen () { yield toTypedArray('W9 NO [SERVERBUG] Internal error occurred. Refer to server log for more information. [2023-01-31 15:07:10] (0.000 + 0.000 secs).') }

      client._parseIncomingCommands(gen())

      expect(client.onready.callCount).to.equal(1)

      expect(client._handleResponse.withArgs({
        tag: 'W9',
        command: 'NO',
        attributes: [
          {
            type: 'ATOM',
            value: '',
            section: [
              {
                type: 'ATOM',
                value: 'SERVERBUG'
              }
            ]
          },
          {
            type: 'TEXT',
            value: 'Internal error occurred. Refer to server log for more information. 2023-01-31 15:07:10 0.000  0.000 secs.'
          }
        ],
        humanReadable: 'Internal error occurred. Refer to server log for more information. 2023-01-31 15:07:10 0.000  0.000 secs.',
        code: 'SERVERBUG'
      }).calledOnce).to.be.true
    })

    it('should process an untagged item from the queue', () => {
      sinon.stub(client, '_handleResponse')

      function * gen () { yield toTypedArray('* 1 EXISTS') }

      client._parseIncomingCommands(gen())

      expect(client._handleResponse.withArgs({
        tag: '*',
        command: 'EXISTS',
        attributes: [],
        nr: 1
      }).calledOnce).to.be.true
    })

    it('should process a plus tagged item from the queue', () => {
      sinon.stub(client, 'send')

      function * gen () { yield toTypedArray('+ Please continue') }
      client._currentCommand = {
        data: ['literal data']
      }

      client._parseIncomingCommands(gen())

      expect(client.send.withArgs('literal data\r\n').callCount).to.equal(1)
    })

    it('should process an XOAUTH2 error challenge', () => {
      sinon.stub(client, 'send')

      function * gen () { yield toTypedArray('+ FOOBAR') }
      client._currentCommand = {
        data: [],
        errorResponseExpectsEmptyLine: true
      }

      client._parseIncomingCommands(gen())

      expect(client.send.withArgs('\r\n').callCount).to.equal(1)
    })
  })

  describe('#_handleResponse', () => {
    it('should invoke global handler by default', () => {
      sinon.stub(client, '_processResponse')
      sinon.stub(client, '_sendRequest')

      client._globalAcceptUntagged.TEST = () => { }
      sinon.stub(client._globalAcceptUntagged, 'TEST')

      client._currentCommand = false
      client._handleResponse({
        tag: '*',
        command: 'test'
      })

      expect(client._sendRequest.callCount).to.equal(1)
      expect(client._globalAcceptUntagged.TEST.withArgs({
        tag: '*',
        command: 'test'
      }).callCount).to.equal(1)
    })

    it('should invoke global handler if needed', () => {
      sinon.stub(client, '_processResponse')
      client._globalAcceptUntagged.TEST = () => { }
      sinon.stub(client._globalAcceptUntagged, 'TEST')
      sinon.stub(client, '_sendRequest')

      client._currentCommand = {
        payload: {}
      }
      client._handleResponse({
        tag: '*',
        command: 'test'
      })

      expect(client._sendRequest.callCount).to.equal(0)
      expect(client._globalAcceptUntagged.TEST.withArgs({
        tag: '*',
        command: 'test'
      }).callCount).to.equal(1)
    })

    it('should push to payload', () => {
      sinon.stub(client, '_processResponse')
      client._globalAcceptUntagged.TEST = () => { }
      sinon.stub(client._globalAcceptUntagged, 'TEST')

      client._currentCommand = {
        payload: {
          TEST: []
        }
      }
      client._handleResponse({
        tag: '*',
        command: 'test'
      })

      expect(client._globalAcceptUntagged.TEST.callCount).to.equal(0)
      expect(client._currentCommand.payload.TEST).to.deep.equal([{
        tag: '*',
        command: 'test'
      }])
    })

    it('should invoke command callback', () => {
      sinon.stub(client, '_processResponse')
      sinon.stub(client, '_sendRequest')
      client._globalAcceptUntagged.TEST = () => { }
      sinon.stub(client._globalAcceptUntagged, 'TEST')

      client._currentCommand = {
        tag: 'A',
        callback: (response) => {
          expect(response).to.deep.equal({
            tag: 'A',
            command: 'test',
            payload: {
              TEST: 'abc'
            }
          })
        },
        payload: {
          TEST: 'abc'
        }
      }
      client._handleResponse({
        tag: 'A',
        command: 'test'
      })

      expect(client._sendRequest.callCount).to.equal(1)
      expect(client._globalAcceptUntagged.TEST.callCount).to.equal(0)
    })
  })

  describe('#enqueueCommand', () => {
    it('should reject on NO/BAD', () => {
      sinon.stub(client, '_sendRequest').callsFake(() => {
        client._clientQueue[0].callback({ command: 'NO' })
      })

      client._tagCounter = 100
      client._clientQueue = []
      client._canSend = true

      return client.enqueueCommand({
        command: 'abc'
      }, ['def'], {
        t: 1
      }).catch((err) => {
        expect(err).to.exist
      })
    })

    it('should invoke sending', () => {
      sinon.stub(client, '_sendRequest').callsFake(() => {
        client._clientQueue[0].callback({})
      })

      client._tagCounter = 100
      client._clientQueue = []
      client._canSend = true

      return client.enqueueCommand({
        command: 'abc'
      }, ['def'], {
        t: 1
      }).then(() => {
        expect(client._sendRequest.callCount).to.equal(1)
        expect(client._clientQueue.length).to.equal(1)
        expect(client._clientQueue[0].tag).to.equal('W101')
        expect(client._clientQueue[0].request).to.deep.equal({
          command: 'abc',
          tag: 'W101'
        })
        expect(client._clientQueue[0].t).to.equal(1)
      })
    })

    it('should only queue', () => {
      sinon.stub(client, '_sendRequest')

      client._tagCounter = 100
      client._clientQueue = []
      client._canSend = false

      setTimeout(() => { client._clientQueue[0].callback({}) }, 0)

      return client.enqueueCommand({
        command: 'abc'
      }, ['def'], {
        t: 1
      }).then(() => {
        expect(client._sendRequest.callCount).to.equal(0)
        expect(client._clientQueue.length).to.equal(1)
        expect(client._clientQueue[0].tag).to.equal('W101')
      })
    })

    it('should store valueAsString option in the command', () => {
      sinon.stub(client, '_sendRequest')

      client._tagCounter = 100
      client._clientQueue = []
      client._canSend = false

      setTimeout(() => { client._clientQueue[0].callback({}) }, 0)
      return client.enqueueCommand({
        command: 'abc',
        valueAsString: false
      }, ['def'], {
        t: 1
      }).then(() => {
        expect(client._clientQueue[0].request.valueAsString).to.equal(false)
      })
    })
  })

  describe('#_sendRequest', () => {
    it('should enter idle if nothing is to process', () => {
      sinon.stub(client, '_enterIdle')

      client._clientQueue = []
      client._sendRequest()

      expect(client._enterIdle.callCount).to.equal(1)
    })

    it('should send data', () => {
      sinon.stub(client, '_clearIdle')
      sinon.stub(client, 'send')

      client._clientQueue = [{
        request: {
          tag: 'W101',
          command: 'TEST'
        }
      }]
      client._sendRequest()

      expect(client._clearIdle.callCount).to.equal(1)
      expect(client.send.args[0][0]).to.equal('W101 TEST\r\n')
    })

    it('should send partial data', () => {
      sinon.stub(client, '_clearIdle')
      sinon.stub(client, 'send')

      client._clientQueue = [{
        request: {
          tag: 'W101',
          command: 'TEST',
          attributes: [{
            type: 'LITERAL',
            value: 'abc'
          }]
        }
      }]
      client._sendRequest()

      expect(client._clearIdle.callCount).to.equal(1)
      expect(client.send.args[0][0]).to.equal('W101 TEST {3}\r\n')
      expect(client._currentCommand.data).to.deep.equal(['abc'])
    })

    it('should run precheck', (done) => {
      sinon.stub(client, '_clearIdle')

      client._canSend = true
      client._clientQueue = [{
        request: {
          tag: 'W101',
          command: 'TEST',
          attributes: [{
            type: 'LITERAL',
            value: 'abc'
          }]
        },
        precheck: (ctx) => {
          expect(ctx).to.exist
          expect(client._canSend).to.be.true
          client._sendRequest = () => {
            expect(client._clientQueue.length).to.equal(2)
            expect(client._clientQueue[0].tag).to.include('.p')
            expect(client._clientQueue[0].request.tag).to.include('.p')
            client._clearIdle.restore()
            done()
          }
          client.enqueueCommand({}, undefined, {
            ctx: ctx
          })
          return Promise.resolve()
        }
      }]
      client._sendRequest()
    })
  })

  describe('#_enterIdle', () => {
    it('should set idle timer', (done) => {
      client.onidle = () => {
        done()
      }
      client.timeoutEnterIdle = 1

      client._enterIdle()
    })
  })

  describe('#_processResponse', () => {
    it('should set humanReadable', () => {
      var response = {
        tag: '*',
        command: 'OK',
        attributes: [{
          type: 'TEXT',
          value: 'Some random text'
        }]
      }
      client._processResponse(response)

      expect(response.humanReadable).to.equal('Some random text')
    })

    it('should set response code', () => {
      var response = {
        tag: '*',
        command: 'OK',
        attributes: [{
          type: 'ATOM',
          section: [{
            type: 'ATOM',
            value: 'CAPABILITY'
          }, {
            type: 'ATOM',
            value: 'IMAP4REV1'
          }, {
            type: 'ATOM',
            value: 'UIDPLUS'
          }]
        }, {
          type: 'TEXT',
          value: 'Some random text'
        }]
      }
      client._processResponse(response)
      expect(response.code).to.equal('CAPABILITY')
      expect(response.capability).to.deep.equal(['IMAP4REV1', 'UIDPLUS'])
    })
  })

  describe('#isError', () => {
    it('should detect if an object is an error', () => {
      expect(client.isError(new RangeError('abc'))).to.be.true
      expect(client.isError('abc')).to.be.false
    })
  })

  describe('#enableCompression', () => {
    it('should create inflater and deflater streams', () => {
      client.socket.ondata = () => { }
      sinon.stub(client.socket, 'ondata')

      expect(client.compressed).to.be.false
      client.enableCompression()
      expect(client.compressed).to.be.true

      const payload = 'asdasd'
      const expected = payload.split('').map(char => char.charCodeAt(0))

      client.send(payload)
      const actualOut = socketStub.send.args[0][0]
      client.socket.ondata({ data: actualOut })
      expect(Buffer.from(client._socketOnData.args[0][0].data)).to.deep.equal(Buffer.from(expected))
    })
  })

  describe('#getPreviouslyQueued', () => {
    const ctx = {}

    it('should return undefined with empty queue and no current command', () => {
      client._currentCommand = undefined
      client._clientQueue = []

      expect(testAndGetAttribute()).to.be.undefined
    })

    it('should return undefined with empty queue and non-SELECT current command', () => {
      client._currentCommand = createCommand('TEST')
      client._clientQueue = []

      expect(testAndGetAttribute()).to.be.undefined
    })

    it('should return current command with empty queue and SELECT current command', () => {
      client._currentCommand = createCommand('SELECT', 'ATTR')
      client._clientQueue = []

      expect(testAndGetAttribute()).to.equal('ATTR')
    })

    it('should return current command with non-SELECT commands in queue and SELECT current command', () => {
      client._currentCommand = createCommand('SELECT', 'ATTR')
      client._clientQueue = [
        createCommand('TEST01'),
        createCommand('TEST02')
      ]

      expect(testAndGetAttribute()).to.equal('ATTR')
    })

    it('should return last SELECT before ctx with multiple SELECT commands in queue (1)', () => {
      client._currentCommand = createCommand('SELECT', 'ATTR01')
      client._clientQueue = [
        createCommand('SELECT', 'ATTR'),
        createCommand('TEST'),
        ctx,
        createCommand('SELECT', 'ATTR03')
      ]

      expect(testAndGetAttribute()).to.equal('ATTR')
    })

    it('should return last SELECT before ctx with multiple SELECT commands in queue (2)', () => {
      client._clientQueue = [
        createCommand('SELECT', 'ATTR02'),
        createCommand('SELECT', 'ATTR'),
        ctx,
        createCommand('SELECT', 'ATTR03')
      ]

      expect(testAndGetAttribute()).to.equal('ATTR')
    })

    it('should return last SELECT before ctx with multiple SELECT commands in queue (3)', () => {
      client._clientQueue = [
        createCommand('SELECT', 'ATTR02'),
        createCommand('SELECT', 'ATTR'),
        createCommand('TEST'),
        ctx,
        createCommand('SELECT', 'ATTR03')
      ]

      expect(testAndGetAttribute()).to.equal('ATTR')
    })

    function testAndGetAttribute () {
      const data = client.getPreviouslyQueued(['SELECT'], ctx)
      if (data) {
        return data.request.attributes[0].value
      }
    }

    function createCommand (command, attribute) {
      const attributes = []
      const data = {
        request: { command, attributes }
      }

      if (attribute) {
        data.request.attributes.push({
          type: 'STRING',
          value: attribute
        })
      }

      return data
    }
  })
})
