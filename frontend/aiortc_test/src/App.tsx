import React from 'react';
import { useState } from 'react';
import './App.css';
import AudioElement from './AudioElement';
import VideoElement from './VideoElement';


var dcInterval: any = null;
const SERVER_HOST: string = "localhost";
const SERVER_PORT: number = 8001;

const escapeRegExp = (str: string) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}


const sdpFilterCodec = (kind: string, codec: string, realSdp: string) => {
  var allowed = []
  var rtxRegex = new RegExp('a=fmtp:(\\d+) apt=(\\d+)\r$');
  var codecRegex = new RegExp('a=rtpmap:([0-9]+) ' + escapeRegExp(codec))
  var videoRegex = new RegExp('(m=' + kind + ' .*?)( ([0-9]+))*\\s*$')
  
  var lines = realSdp.split('\n');

  var isKind = false;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('m=' + kind + ' ')) {
      isKind = true;
    } else if (lines[i].startsWith('m=')) {
      isKind = false;
    }

    if (isKind) {
      var match = lines[i].match(codecRegex);
      if (match) {
        allowed.push(parseInt(match[1]));
      }

      match = lines[i].match(rtxRegex);
      if (match && allowed.includes(parseInt(match[2]))) {
        allowed.push(parseInt(match[1]));
      }
    }
  }

  var skipRegex = 'a=(fmtp|rtcp-fb|rtpmap):([0-9]+)';
  var sdp = '';

  isKind = false;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('m=' + kind + ' ')) {
      isKind = true;
    } else if (lines[i].startsWith('m=')) {
      isKind = false;
    }

    if (isKind) {
      var skipMatch = lines[i].match(skipRegex);
      if (skipMatch && !allowed.includes(parseInt(skipMatch[2]))) {
          continue;
      } else if (lines[i].match(videoRegex)) {
          sdp += lines[i].replace(videoRegex, '$1 ' + allowed.join(' ')) + '\n';
      } else {
          sdp += lines[i] + '\n';
      }
    } else {
      sdp += lines[i] + '\n';
    }
  }

  return sdp;
}


const createPeerConnection = (useStun: boolean = false) => {
  const config: any = {
    sdpSemantics: 'unified-plan'
  };

  if (useStun) {
    config.iceServers = [{urls: ['stun:stun.l.google.com:19302']}];
  }

  const pc = new RTCPeerConnection(config);

  // register some listeners to help debugging
  pc.addEventListener('icegatheringstatechange', () => {
    console.log(`icegatheringstatechange : ${pc.iceGatheringState}`);
  }, false);

  pc.addEventListener('iceconnectionstatechange', () => {
    console.log(`iceconnectionstatechange : ${pc.iceConnectionState}`);
  }, false);

  pc.addEventListener('signalingstatechange', () => {
    console.log(`signalingstatechange : ${pc.signalingState}`);
  }, false);

  // connect audio / video
  pc.addEventListener('track', function(evt) {
    if (evt.track.kind == 'video') {
      const video_: any = document.getElementById('display_video');
      video_.srcObject = evt.streams[0];
      console.log("document.getElementById('video').srcObject = evt.streams[0];");
      console.log(evt.streams[0]);
    } else {
      const audio_: any = document.getElementById('display_audio')
      audio_.srcObject = evt.streams[0];
      console.log("document.getElementById('audio').srcObject = evt.streams[0];");
    }
  });

  return pc;
}


const negotiate = (pc: any, serverHost: string, serverPort: string) => {
  return pc.createOffer().then((offer: any) => {
    return pc.setLocalDescription(offer);
  }).then(() => {
    // wait for ICE gathering to complete
    return new Promise<void>(function(resolve) {
      if (pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        }
        pc.addEventListener('icegatheringstatechange', checkState);
      }
    });
  }).then(() => {
    const offer = pc.localDescription;
    var codec;

    codec = 'default';  // or 'opus/48000/2' or 'PCMU/8000' or 'PCMA/8000'
    if (codec !== 'default') {
      offer.sdp = sdpFilterCodec('audio', codec, offer.sdp);
    }

    codec = 'default';  // or 'VP8/90000' or 'H264/90000'
    if (codec !== 'default') {
      offer.sdp = sdpFilterCodec('video', codec, offer.sdp);
    }

    // document.getElementById('offer-sdp').textContent = offer.sdp;
    console.log(`offer.sdp : ${offer.sdp}`);
    return fetch(`http://${serverHost}:${serverPort}/offer`, {
      body: JSON.stringify({
        sdp: offer.sdp,
        typ: offer.type,
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    });
  }).then((response: any) => {
      return response.json();
  }).then((answer: any) => {
    // document.getElementById('answer-sdp').textContent = answer.sdp;
    console.log(`answer.sdp : ${answer.sdp}`);
    return pc.setRemoteDescription(answer);
  }).catch((e: any) => {
    alert(e);
  });
}

const start = (started: boolean, setPc: any, setDc: any, serverHost: string, serverPort: string) => {
  const pc = createPeerConnection();
  setPc(pc);

  let timeStart: any = null;
  const currentStamp = () => {
    if (timeStart === null) {
      timeStart = new Date().getTime();
        return 0;
    } else {
        return new Date().getTime() - timeStart;
    }
  }

  const useDataChannel = true;
  if (useDataChannel) {
    const defaultParams = {"ordered": true}
    var parameters = defaultParams;

    const dc = pc.createDataChannel('chat', parameters);
    dc.onclose = () => {
      clearInterval(dcInterval);
      console.log('dc.onclose');
    };
    dc.onopen = () => {
      console.log('dc.onopen');
      dcInterval = setInterval(function() {
        const message = 'ping ' + currentStamp();
        console.log(`ping > ${message}`);
        dc.send(message);
      }, 1000);
    };
    dc.onmessage = function(evt) {
      console.log(`dc.onmessage < ${evt.data}`);

      if (evt.data.substring(0, 4) === 'pong') {
        var elapsed_ms = currentStamp() - parseInt(evt.data.substring(5), 10);
        console.log(`dc.onmessage :  RTT ${elapsed_ms} ms`);
      }
    };
  }

  const constraints: any = {
    audio: true,
    video: false
  };
  const useVideo: boolean = true;
  const defaultVideoResolution: string = '';
  if (useVideo) {
    if (defaultVideoResolution) {
      const resolutions: string[] = defaultVideoResolution.split('x');
      constraints.video = {
          width: parseInt(resolutions[0], 0),
          height: parseInt(resolutions[1], 0)
      };
    } else {
        constraints.video = true;
    }
  }

  const mock: any = document.getElementById('mock_canvas');
  const fps = 50;
  const stream = mock.captureStream(fps);
  // pc.addStrem(stream);
  stream.getTracks().forEach((track: any) => {
    pc.addTrack(track, stream);
  });
  negotiate(pc, serverHost, serverPort);

}

const stop = (pc: any, dc: any) => {
  // close data channel
  if (dc) {
    dc.close();
  }

  // close transceivers
  if (pc.getTransceivers) {
    pc.getTransceivers().forEach((transceiver: any) => {
        if (transceiver.stop) {
            transceiver.stop();
        }
    });
  }

  // close local audio / video
  pc.getSenders().forEach((sender: any) => {
    sender.track.stop();
  });

  // close peer connection
  setTimeout(function() {
    pc.close();
  }, 500);
}

const startOrStop = (
  started: boolean,
  pc: any,
  dc: any,
  setPc: any,
  setDc: any,
  serverHost: string,
  serverPort: string,
) => {
  if (started) {
    stop(pc, dc);
  } else {
    start(started, setPc, setDc, serverHost, serverPort);
  }
}

const useAnimationFrame = (isRunning: boolean, callback = () => {}) => {
  const reqIdRef = React.useRef<number>();
  const loop = React.useCallback(() => {
    if (isRunning) {
      reqIdRef.current = requestAnimationFrame(loop);
      callback();
    }
  }, [isRunning, callback]);

  React.useEffect(() => {
    reqIdRef.current = requestAnimationFrame(loop);
    return () => {
      if (reqIdRef.current !== undefined) {
        cancelAnimationFrame(reqIdRef.current)
      }
    };
  }, [loop]);
};



function App() {
  const [started, setStarted] = useState<boolean>(false);
  const [pc, setPc] = useState<any>(null);
  const [dc, setDc] = useState<any>(null);
  const [serverHost, setServerHost] = useState<string>("localhost");
  const [serverPort, setServerPort] = useState<string>("8001");

  const animationCallback = React.useCallback(() => {
    console.log('redraw')
    const mock: any = document.getElementById('mock_canvas');
    const ctx: any = mock.getContext("2d");
    // ctx.clearRect(0, 0, mock.width, mock.height);
    ctx.fillStyle = "#ff6";
    ctx.fillRect(0, 0, mock.width, mock.height);
  }, []);
  useAnimationFrame(started, animationCallback);

  return (
    <div className="App">
      <div>
        SERVER HOST : <input type="text" onChange={(e: any) => setServerHost(e.value)} value={serverHost}></input>
        SERVER PORT : <input type="text" onChange={(e: any) => setServerPort(e.value)} value={serverPort}></input>
        <button onClick={ () => {
          startOrStop(started, pc, dc, setPc, setDc, serverHost, serverPort);
          setStarted(!started);
        } }>
          {started ? "STOP" : "START"}
        </button>
      </div>
      <VideoElement id="display_video"></VideoElement>
      <AudioElement id="display_audio"></AudioElement>
    </div>
  );
}

export default App;
