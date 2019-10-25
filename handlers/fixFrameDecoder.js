exports.newFixFrameDecoder = function() {
  return new fixFrameDecoder();
};

const util = require('util');

// static vars
const SOHCHAR = String.fromCharCode(1);
const ENDOFTAG8 = 10;
const STARTOFTAG9VAL = ENDOFTAG8 + 2;
const SIZEOFTAG10 = 8;

function fixFrameDecoder() {
  this.buffer = '';
  const self = this;
  this.incoming = function(ctx, event) {
    if (event.type !== 'data') {
      ctx.sendNext(event);
      return;
    }

    const stream = ctx.stream;
    self.buffer = self.buffer + event.data;
    while (self.buffer.length > 0) {
      // ====================================Step 1: Extract complete FIX message====================================

      // If we don't have enough data to start extracting body length, wait for more data
      if (self.buffer.length <= ENDOFTAG8) {
        return;
      }

      const _idxOfEndOfTag9Str = self.buffer.substring(ENDOFTAG8).indexOf(SOHCHAR);
      const idxOfEndOfTag9 = parseInt(_idxOfEndOfTag9Str, 10) + ENDOFTAG8;

      if (isNaN(idxOfEndOfTag9)) {
        var error = '[ERROR] Unable to find the location of the end of tag 9. Message probably malformed: ' +
                    self.buffer.toString();
        util.log(error);
        stream.end();
        ctx.sendNext({data: error, type: 'error'});
        return;
      }


      // If we don't have enough data to stop extracting body length AND we have received a lot of data
      // then perhaps there is a problem with how the message is formatted and the session should be killed
      if (idxOfEndOfTag9 < 0 && self.buffer.length > 100) {
        var error ='[ERROR] Over 100 character received but body length still not extractable.  Message malformed: ' +
                    databuffer.toString();
        util.log(error);
        stream.end();
        ctx.sendNext({data: error, type: 'error'});
        return;
      }


      // If we don't have enough data to stop extracting body length, wait for more data
      if (idxOfEndOfTag9 < 0) {
        return;
      }

      const _bodyLengthStr = self.buffer.substring(STARTOFTAG9VAL, idxOfEndOfTag9);
      const bodyLength = parseInt(_bodyLengthStr, 10);
      if (isNaN(bodyLength)) {
        var error = '[ERROR] Unable to parse bodyLength field. Message probably malformed: bodyLength=\'' +
                    _bodyLengthStr + '\', msg=' + self.buffer.toString();
        util.log(error);
        stream.end();
        ctx.sendNext({data: error, type: 'error'});
        return;
      }

      const msgLength = bodyLength + idxOfEndOfTag9 + SIZEOFTAG10;

      // If we don't have enough data for the whole message, wait for more data
      if (self.buffer.length < msgLength) {
        return;
      }

      // Message received!
      const msg = self.buffer.substring(0, msgLength);
      if (msgLength == self.buffer.length) {
        self.buffer = '';
      } else {
        const remainingBuffer = self.buffer.substring(msgLength);
        self.buffer = remainingBuffer;
      }

      // ====================================Step 2: Validate message====================================

      const calculatedChecksum = checksum(msg.substr(0, msg.length - 7));
      const extractedChecksum = msg.substr(msg.length - 4, 3);

      if (calculatedChecksum !== extractedChecksum) {
        var error = '[WARNING] Discarding message because body length or checksum are wrong (expected checksum: ' +
                    calculatedChecksum + ', received checksum: ' + extractedChecksum + '): [' + msg + ']';
        util.log(error);
        ctx.sendnext({data: error, type: 'error'});
        return;
      }


      ctx.sendNext({data: msg, type: 'data'});
    }
  };

  this.outgoing = function(ctx, event) {
    if (event.type !== 'data') {
      ctx.sendNext(event);
      return;
    }

    if (ctx.stream.writable) {
      ctx.stream.write(event.data);
    }
    ctx.sendNext(event);
  };
}

function checksum(str) {
  let chksm = 0;
  for (let i = 0; i < str.length; i++) {
    chksm += str.charCodeAt(i);
  }

  chksm = chksm % 256;

  let checksumstr = '';
  if (chksm < 10) {
    checksumstr = '00' + (chksm + '');
  } else if (chksm >= 10 && chksm < 100) {
    checksumstr = '0' + (chksm + '');
  } else {
    checksumstr = '' + (chksm + '');
  }

  return checksumstr;
}
