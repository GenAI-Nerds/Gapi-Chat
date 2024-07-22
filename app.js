
// HARDCODE THE FOLLOWING 4 if you like else enter them in html widgets
var url = "";//"ws://localhost:8090/gapi-ws"
var gapiKey = "";
var workflowKey = "";
var microServiceKey = "";
var nodeKey = "";

var workflowMode = "idle";
var mode = "init";
var ws;

var messageTimer;
var retryConnectTime = 6000;
var messageInterval = 60000;

var textEncoder = new TextEncoder();
var headerBytes;
var jsonBytes;

function onLoad() {

    var queryString = window.location.search;
    var params = new URLSearchParams(queryString);
    console.log("QueryString: " + queryString);
    
    document.getElementById("gapiUrl").value = params.get("gapiUrl");
    document.getElementById("gapiKey").value = params.get("gapiKey");
    document.getElementById("workflowKey").value = params.get("workflowKey");
    document.getElementById("nodeKey").value = params.get("nodeKey");
    document.getElementById("microServiceKey").value = params.get("microServiceKey");
    
    toggleFlow();
    document.getElementById("connected-label").innerHTML = "Connecting...";
    
    var promptBox = document.getElementById("prompt-box");
    promptBox.addEventListener('keydown', function(event) {
        // Step 3: Check if the Enter key (key code 13) was pressed
        if (event.key === 'Enter' || event.keyCode === 13) {
            // Step 4: Execute your desired action
            postPrompt();
        }
    });
}

function encodeMicroServiceMsg(binBytesArrayBuffer) {
    
  console.log("Encoding");

  var idx = 0;  
  if (!headerBytes) {
      
    var msm = {
      "workflowKey": workflowKey,
      "nodeKey": nodeKey,
      "microServiceKey": microServiceKey,
      "destination": "microService",
      "message": "{\"loudnessThreshold\": " + loudnessThreshold + ", \"minSilenceWindowMs\": " + minSilenceWindowMs + "}"
    }
  
    headerBytes = new ArrayBuffer(8); //4 bytes magic plus 4 bytes jsonLen
    var view = new DataView(headerBytes);
    view.setUint8(idx++, 20); //magic
    view.setUint8(idx++, 10);
    view.setUint8(idx++, 5);
    view.setUint8(idx++, 17);
    
    var msmAsJson = JSON.stringify(msm);
    var jsonLen = msmAsJson.length;
    view.setUint32(idx, jsonLen, true); // true = little endian
    idx += 4;
    
    jsonBytes = textEncoder.encode(msmAsJson);
  }
  else {
    idx = 8;
  }
  
  // Concat 4 bytes magic plus jsonLen plus json as bytes plus binary bytes
  var outBytesLen = idx + jsonBytes.length + binBytesArrayBuffer.byteLength;
  var outBytes = new Uint8Array(outBytesLen);
  outBytes.set(new Uint8Array(headerBytes), 0); // header
  outBytes.set(jsonBytes, idx);
  
  idx += jsonBytes.length;
  
  if (binBytesArrayBuffer.byteLength > 0) {
      
    outBytes.set(new Uint8Array(binBytesArrayBuffer), idx);
  }

  return outBytes;
}

function toggleFlow() {
  
  console.log("ToggleFlow: Started----------------->");  
  
  if (url.length == 0) {
   url = document.getElementById("gapiUrl").value;
  }

  if (gapiKey.length == 0) {
    gapiKey = document.getElementById("gapiKey").value;
  }

  if (workflowKey.length == 0) {
    workflowKey = document.getElementById("workflowKey").value;
  }

  if (nodeKey.length == 0) {
    nodeKey = document.getElementById("nodeKey").value;
  }

  if (microServiceKey.length == 0) {
    microServiceKey = document.getElementById("microServiceKey").value;
  }

  console.log("startFlow(), gapiKey: " + gapiKey + ", workflowKey: " + workflowKey + ", nodeKey: " + nodeKey + ", microServiceKey: " + microServiceKey);

  connect();
}

function connect() {

  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = function() {

    console.log("Websocket: connected");
    
    document.getElementById("connected-label").innerHTML = "Connected";

    startMessageTimer();
    mode = "sendStartSession";
    
    {
      let o = {
        key: gapiKey,
        apiServiceName: 'hello'
      }

      sendMsg(o);
    }

    {
      let o = {
        key: gapiKey,
        apiServiceName: 'watchWorkflow',
        workflowKey: workflowKey
      }

      sendMsg(o);
    }
  };

  ws.onmessage = function (evt) { 

    var msg = evt.data;

    console.log("onMessage: " + msg);
    var o = JSON.parse(msg);
    if (o.workflowStatusResponse) {

      if (o.workflowStatusResponse.type == "nodeFireDone") { return; }
      
      let jsonStr = o.workflowStatusResponse.transaction.nodeSteps[0].resultingData;
      var x = JSON.parse(jsonStr);
      addChatItem(x.response);
    }

  };

  ws.onclose = function() { 

    console.log("[ERROR] Websocket: closed");
    document.getElementById("connected-label").innerHTML = "Closed...";
    stopMessageTimer();
    shutdown();
    setTimeout(connect, retryConnectTime);
  };

  ws.onerror = function(e) {

    document.getElementById("connected-label").innerHTML = "Error...";
    console.log("Websocket: error: " + e.data);
  }
}

function addPromptBox(text) {

  let container = document.getElementById("chat-container");
  let chatItem = document.createElement("div");
  chatItem.innerHTML = text;
  chatItem.classList.add("prompt-item");
  container.appendChild(chatItem);
}

function addChatItem(text) {

  let container = document.getElementById("chat-container");
  let chatItem = document.createElement("div");
  chatItem.innerHTML = text;
  chatItem.classList.add("chat-item");
  container.appendChild(chatItem);
}

function postPrompt() {
    
  console.log("postMessage()");

  
  
  let prompt = document.getElementById("prompt-box").value;
  document.getElementById("prompt-box").value = '';
  if (prompt.length == 0) { return; }

  addPromptBox(prompt);

  let dataObj = {
    llmPrompt: prompt
  }

  let o = {
    key: gapiKey,
    apiServiceName: "workflowInvoke",
    wfKey: workflowKey,
    nodeKey: nodeKey,
    data: dataObj
  }

  sendRequest(o);

}

function startMessageTimer() {
    if (messageTimer) {
        clearInterval(messageTimer);
    }
    messageTimer = setInterval(function() {
        if (ws && ws.readyState === WebSocket.OPEN) {

            let o = {
              key: "",
              apiServiceName: "ping"
            }

            sendMsg(o);
        }
    }, messageInterval);
}

function stopMessageTimer() {
    if (messageTimer) {
        clearInterval(messageTimer);
        messageTimer = null;
    }
}

function sendMsg(o) {

  let asString = JSON.stringify(o);
  console.log("sendRequest: " + asString);
  ws.send(asString);
}

function sendRequest(obj) {

  sendMsg(obj);
}