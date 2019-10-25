const fix = require('./fix.js');

let orderIDs = 1;
let execIDs = 1;

fix.createServer({}, function(session) {
  console.log('EVENT connect');
  session.on('end', function(sender, target) {
    console.log('EVENT end');
  });
  session.on('logon', function(sender, target) {
    console.log('EVENT logon: '+ sender + ', ' + target);
  });
  session.on('incomingmsg', function(sender, target, msg) {
    console.log('EVENT incomingmsg: '+ JSON.stringify(msg));
    const msgType = msg['35'];

    // new order single
    if (msgType === 'D') {
      const type = msg['40'];
      const isLimit = msg['40'] === '2';

      // send fill
      const orderID = orderIDs++;
      const clOrdID = msg['11'];
      const execID = execIDs++;
      const execTransType = '0'; // new
      const execType = '2';// fill
      const ordStatus = '2'; // filled
      const symbol = msg['55'];
      const side = msg['54'];
      const qty = msg['38'];
      const leaves = 0;
      const cumQty = qty;
      const avgpx = 100; // if there is limit price, this will be overwritten by limit
      const lastpx = 100; // if there is limit price, this will be overwritten by limit
      const lastshares = qty;

      const outmsg = {'35': '8', '37': orderID, '11': clOrdID, '17': execID, '20': execTransType, '150': execType, '39': ordStatus, '55': symbol, '54': side, '38': qty, '151': leaves, '14': cumQty, '6': avgpx, '32': lastshares, '31': lastpx};
      if (isLimit) {
        outmsg['44'] = msg['44']; // price
        outmsg['6'] = msg['44']; // avg px
        outmsg['31'] = msg['44']; // last price
      }

      session.write(outmsg);
    }
  });
  session.on('outgoingmsg', function(sender, target, msg) {
    console.log('EVENT outgoingmsg: '+ JSON.stringify(msg));
  });
}).listen(1234, 'localhost');

