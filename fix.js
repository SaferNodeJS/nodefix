var net = require("net");
var events = require("events");
var sys = require("sys");

//static vars
var SOHCHAR = String.fromCharCode(1);
var ENDOFTAG8 = 10;
var STARTOFTAG9VAL = ENDOFTAG8 + 2;
var SIZEOFTAG10 = 8;



function Session(stream, opt) {
    events.EventEmitter.call(this);
    var self = this;

    stream.setEncoding("ascii");
    stream.setTimeout(1000);

    this.stream = stream;
    var fixVersion = opt.version;
    var headers = opt.headers;
    var trailers = opt.trailers;

    //session vars
    var senderCompID = ""; //senderCompID || "";
    var targetCompID = ""; //targetCompID || "";
    var heartbeatDuration = 0;

    //this.databufferx = "";
    var databuffer = "";
    var charlen = 0;

    var loggedIn = false;
    var incomingSeqNum = 1;
    var outgoingSeqNum = 1;
    var timeOfLastIncoming = 0;
    var timeOfLastOutgoing = 0;

    var heartbeatIntervalIDs = [];
    

    /*this.addListener("connect", function () {
        sys.log("New session started");
    });
    this.addListener("end", function () {
        sys.log("Session ended");
    });*/
    

    var heartbeatCallback = function () {

        var currentTime = new Date().getTime();

        if (currentTime - timeOfLastOutgoing > heartbeatDuration) {
            writefix({
                "35": "0"
            }); /*write heartbeat*/
        }

        if (currentTime - timeOfLastIncoming > heartbeatDuration * 1.5) {
            writefix({
                "35": "1",
                "112": outgoingSeqNum + ""
            }); /*write testrequest*/
        }

        if (currentTime - timeOfLastIncoming > heartbeatDuration * 3) {
            sys.log("[ERROR] No message received from counterparty and no response to test request.");
            stream.end();
            return;
        }
    };


    
    //Used for parsing outgoing data -------------------------------
    //this.write = function(msg){ writefix(msg);};
    function writefix(msg) {

        var senderCompIDExtracted = msg["56"];
        var targetCompIDExtracted = msg["49"];

        delete msg["9"]; //bodylength
        delete msg["10"]; //checksum
        delete msg["52"]; //timestamp
        delete msg["8"]; //fixversion
        delete msg["56"]; //sendercompid
        delete msg["49"]; //targetcompid
        delete msg["34"]; //seqnum
        var headermsg = "";
        for (var f in headers) {
            if (headers.hasOwnProperty(f)) {
                var tag = headers[f];

                if (tag == "8" || tag == "9" || tag == "59" || tag == "52" || tag == "56" || tag == "49" || tag == "34") {
                    continue;
                }

                if (tag.charAt(tag.length - 1) != "?" && msg[tag] === undefined) { //If tag is required, but missing
                    sys.log("[ERROR] tag " + tag + " is required but missing in outgoing message: " + msg);
                    return;
                }

                if (msg[tag] !== undefined) {
                    headermsg += tag + "=" + msg[tag] + SOHCHAR;
                    delete msg[tag];
                }
            }
        }

        var timestamp = new Date();
        headermsg += "52=" + timestamp.getUTCFullYear() + timestamp.getUTCMonth() + timestamp.getUTCDay() + "-" + timestamp.getUTCHours() + ":" + timestamp.getUTCMinutes() + ":" + timestamp.getUTCSeconds() + "." + timestamp.getUTCMilliseconds() + SOHCHAR;
        headermsg += "56=" + (senderCompIDExtracted || senderCompID) + SOHCHAR;
        headermsg += "49=" + (targetCompIDExtracted || targetCompID) + SOHCHAR;
        headermsg += "34=" + (outgoingSeqNum++) + SOHCHAR;

        var trailermsg = "";
        for (var f in trailers) {
            if (trailers.hasOwnProperty(f)) {
                var tag = trailers[f];

                if (tag == "10") {
                    continue;
                }

                if (tag.charAt(tag.length - 1) != "?" && msg[tag] === undefined) { //If tag is required, but missing
                    sys.log("[ERROR] tag " + tag + " is required but missing in outgoing message: " + msg);
                    return;
                }

                if (msg[tag] !== undefined) {
                    trailermsg += tag + "=" + msg[tag] + SOHCHAR;
                    delete msg[tag];
                }

            }
        }

        var bodymsg = "";
        for (var tag in msg) {
            if (msg.hasOwnProperty(tag)) {
                bodymsg += tag + "=" + msg[tag] + SOHCHAR;
            }
        }

        var outmsg = "";
        outmsg += "8=" + fixVersion + SOHCHAR;
        outmsg += "9=" + (headermsg.length + bodymsg.length + trailermsg.length) + SOHCHAR;
        outmsg += headermsg;
        outmsg += bodymsg;
        outmsg += trailermsg;

        var checksum = 0;
        for (var x in outmsg) {
            if (outmsg.hasOwnProperty(x)) {
                checksum += outmsg.charCodeAt(x);
            }
        }
        checksum = checksum % 256;

        var checksumstr = "";
        if (checksum < 10) {
            checksumstr = "00" + checksum;
        }
        else if (checksum >= 10 && checksum < 100) {
            checksumstr = "0" + checksum;
        }
        else {
            checksumstr = "" + checksum;
        }

        outmsg += "10=" + checksumstr + SOHCHAR;

        sys.log("FIX out:" + outmsg);
        timeOfLastOutgoing = new Date().getTime();
        this.stream.write(outmsg);
    }

    this.write = writefix;


    //Used for parsing incoming data -------------------------------
    //this.handle = function() { return function (data) {
    //var handle = function (data) {
    function handlefix(data){
    
        sys.log("data received: " + data);

        //Add data to the buffer (to avoid processing fragmented TCP packets)
        //var databuffer = this.databufferx + data;
        databuffer = databuffer + data;
        timeOfLastIncoming = new Date().getTime();

        while (databuffer.length > 0) {
            sys.log("NEW LOOP:" + databuffer.length + ":" + databuffer);

            //====Step 1: Extract complete FIX message====
            //If we don't have enough data to start extracting body length, wait for more data
            if (databuffer.length <= ENDOFTAG8) {
                return;
            }

            var _idxOfEndOfTag9Str = databuffer.substring(ENDOFTAG8).indexOf(SOHCHAR);
            var idxOfEndOfTag9 = parseInt(_idxOfEndOfTag9Str, 10) + ENDOFTAG8;

            if (isNaN(idxOfEndOfTag9)) {
                sys.log("[ERROR] Unable to find the location of the end of tag 9. Message probably misformed: " + databuffer.toString());
                stream.end();
                return;
            }


            //If we don't have enough data to stop extracting body length AND we have received a lot of data
            //then perhaps there is a problem with how the message is formatted and the session should be killed
            if (idxOfEndOfTag9 < 0 && databuffer.length > 100) {
                sys.log("[ERROR] Over 100 character received but body length still not extractable.  Message probably misformed: " + databuffer.toString());
                stream.end();
                return;
            }


            //If we don't have enough data to stop extracting body length, wait for more data
            if (idxOfEndOfTag9 < 0) {
                return;
            }

            var _bodyLengthStr = databuffer.substring(STARTOFTAG9VAL, idxOfEndOfTag9);
            var bodyLength = parseInt(_bodyLengthStr, 10);
            if (isNaN(bodyLength)) {
                sys.log("[ERROR] Unable to parse bodyLength field. Message probably misformed: " + databuffer.toString());
                stream.end();
                return;
            }

            var msgLength = bodyLength + idxOfEndOfTag9 + SIZEOFTAG10;

            //If we don't have enough data for the whole message, wait for more data
            if (databuffer.length < msgLength) {
                return;
            }

            var msg = databuffer.substring(0, msgLength);
            if (msgLength == databuffer.length) {
                databuffer = "";
            }
            else {
                var debugstr = databuffer.substring(msgLength);
                sys.log("[DEBUG] debugstr:" + debugstr);
                databuffer = debugstr;
            }

            sys.log("FIX in: " + msg);

            //====Step 2: Validate message====
            if (msg.substr(-1 * (SIZEOFTAG10 - 1), 3) != "10=") {
                sys.log("[WARNING] Discarding message because according to body length, checksum is not at expected location: " + msg);
                continue;
            }

            //====Step 3: Convert to map====
            var keyvals = msg.split(SOHCHAR);
            //sys.debug("keyvals:"+keyvals);
            var fix = {};
            for (var kv in keyvals) {
                if (keyvals.hasOwnProperty(kv)) {
                    var kvpair = keyvals[kv].split("=");
                    fix[kvpair[0]] = kvpair[1];

                }
            }

            //var dbg = "{";
            //for( var x in fix){ dbg += ","+x+":"+fix[x]+"";}
            //sys.debug(dbg+"}");
            //====Step 4: Confirm all required fields are available====
            for (var f in headers) {
                if (headers.hasOwnProperty(f)) {
                    var tag = headers[f];
                    if (tag.charAt(tag.length - 1) != "?" && fix[tag] === undefined) { //If tag is required, but missing
                        sys.log("[ERROR] tag " + tag + " is required but missing in incoming message: " + msg);
                        if (loggedIn) {
                            writefix({
                                "35": "3",
                                "45": fix["34"],
                                "58": "MissingTags"
                            }); /*write session reject*/
                        }
                        else {
                            stream.end();
                            return;
                        }
                    }
                }
            }

            for (var f in trailers) {
                if (trailers.hasOwnProperty(f)) {
                    var tag = trailers[f];
                    if (tag.charAt(tag.length - 1) != "?" && fix[tag] === undefined) { //If tag is required, but missing
                        sys.log("[ERROR] tag " + tag + " is required but missing in incoming message: " + msg);
                        if (loggedIn) {
                            writefix({
                                "35": "3",
                                "45": fix["34"],
                                "58": "MissingTags"
                            }); /*write session reject*/
                        }
                        else {
                            stream.end();
                            return;
                        }
                    }
                }
            }

            //====Step 5: Confirm first message is a logon message and it has a heartbeat
            var msgType = fix["35"];
            if (!loggedIn && msgType != "A") {
                sys.log("[ERROR] Logon message expected, received message of type " + msgType);
                stream.end();
                return;
            }

            if (msgType == "A" && fix["108"] === undefined) {
                sys.log("[ERROR] Logon does not have tag 108 (heartbeat) ");
                stream.end();
                return;
            }


            //====Step 6: Confirm incoming sequence number====
            var _seqNum = parseInt(fix["34"], 10);
            if (loggedIn && _seqNum == incomingSeqNum) {
                incomingSeqNum++;
            }
            else if (loggedIn && _seqNum < incomingSeqNum) {
                sys.log("[ERROR] Incoming sequence number lower than expected. No way to recover.");
                stream.end();
                return;
            }
            else if (loggedIn && _seqNum > incomingSeqNum) {
                //Missing messages, write rewrite request and don't process any more messages
                //until the rewrite request is processed
                //set flag saying "waiting for rewrite"
            }

            //====Step 7: Confirm compids and fix version match what was in the logon msg
            var incomingFixVersion = fix["8"];
            var incomingsenderCompID = fix["56"];
            var incomingTargetCompID = fix["49"];

            if (loggedIn && (fixVersion != incomingFixVersion || senderCompID != incomingsenderCompID || targetCompID != incomingTargetCompID)) {
                sys.log("[WARNING] Incoming fix version (" + incomingFixVersion + "), sender compid (" + incomingsenderCompID + ") or target compid (" + incomingTargetCompID + ") did not match expected values (" + fixVersion + "," + senderCompID + "," + targetCompID + ")"); /*write session reject*/
            }


            //====Step 8: Messages
            switch (msgType) {
            case "0":
                //handle heartbeat; break;
                break;
            case "1":
                //handle testrequest; break;
                var testReqID = fix["112"];
                writefix({
                    "35": "0",
                    "112": testReqID
                }); /*write heartbeat*/
                break;
            case "2":
                //handle rewriterequest; break;
                break;
            case "3":
                //handle sessionreject; break;
                break;
            case "4":
                //handle seqreset; break;
            case "5":
                //handle logout; break;
                writefix({
                    "35": "5"
                }); /*write a logout ack right back*/
                break;
            case "A":
                //handle logon; break;
                fixVersion = fix["8"];
                senderCompID = fix["56"];
                targetCompID = fix["49"];
                heartbeatDuration = parseInt(fix["108"], 10) * 1000;
                loggedIn = true;
                var intervalID = setInterval(heartbeatCallback, heartbeatDuration);
                // TODO: heartbeatIntervalIDs.push(intervalID);
                this.emit("logon", fix);
                sys.log(fix["49"] + " logged on from " + stream.remoteAddress);
                writefix({
                    "35": "A",
                    "108": fix["108"]
                }); /*write logon ack*/
                break;
            default:
            }
            sys.log("[DEBUG] databuffer.length: " + databuffer.length + "; databuffer: " + databuffer);
            this.emit("data", fix);
        }

    }
    
    this.handle = handlefix;
    //this.addListener("data", handlefix);


}
sys.inherits(Session, events.EventEmitter);
//Session.prototype.write = function(msg){ this.writefix(msg);};


function Server() {
    events.EventEmitter.call(this);

}
sys.inherits(Server, events.EventEmitter);
Server.prototype.listen = function (port) {
    this.socket.listen(port);
};
//Server.prototype.disconnect = function(client){ this.socket.listen(port);};

function Client(senderCompID, targetCompID, opt) {
    events.EventEmitter.call(this);

}
sys.inherits(Client, events.EventEmitter);
Client.prototype.end = function () {
    this.socket.end();
};


//events: connect, end, data, logon
exports.createServer = function (opt, func) {

    var server = new Server();

    server.socket = net.createServer(function (stream) {
        var session = new Session(stream, opt);
        func(session);

        stream.addListener("connect", function () {
            session.emit("connect");
        });

        stream.addListener("end", function () {
            stream.end();
            session.emit("end");
        });

        stream.addListener("data",session.handle());
        //stream.addListener("data", function (data) { session.emit("data"); });

    });

    return server;
};

exports.createConnection = function (senderCompID, targetCompID, heartbeatseconds, opt, port, host) {

    var client = new Client(senderCompID, targetCompID, opt);

    var stream = net.createConnection(port, host);

    var session = new Session(stream, opt);

    client.stream = stream;
    stream.addListener("connect", function () {
        session.emit("connect");
        session.write({
            "35": "A",
            "49": senderCompID,
            "56": targetCompID,
            "108": heartbeatseconds,
            "98": 0
        });
    });
    stream.addListener("end", function () {
        session.emit("end");
    });

    stream.addListener("data",session.handle());
    //stream.addListener("data", function (data) { session.emit("data"); });

    return session;
};


//Copyright 2010 Shahbaz Chaudhary (shahbazc@gmail.com)
//Not for public release
//Not publicly lisenced
