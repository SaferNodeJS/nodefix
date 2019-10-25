/* eslint-disable require-jsdoc */
exports.newOutMsgEvtInterceptor = function(session) {
  return new outMsgEvtInterceptor(session);
};


function outMsgEvtInterceptor(session) {
  const self = this;

  this.incoming = function(ctx, event) {
    ctx.sendNext(event);
  };

  this.outgoing = function(ctx, event) {
    if (event.type === 'data') {
      const fixmap = convertToMap(event.data);
      session.sessionEmitter.emit('outgoingmsg', fixmap[49], fixmap[56], fixmap);
    } else if (event.type === 'resync') {
      session.sessionEmitter.emit('outgoingresync', event.data[49], event.data[56], event.data);
    }

    ctx.sendNext(event);
  };
}

// TODO refactor, this is alraedy implemented in logonProcessor.js
// TODO refactor, this is already defined in logonProcessor.js
const SOHCHAR = String.fromCharCode(1);
function convertToMap(msg) {
  const fix = {};
  const keyvals = msg.split(SOHCHAR);
  for (const kv in Object.keys(keyvals)) {
    const kvpair = keyvals[kv].split('=');
    fix[kvpair[0]] = kvpair[1];
  }
  return fix;
}
