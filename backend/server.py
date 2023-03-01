from av import VideoFrame
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from aiortc.contrib.media import MediaBlackhole, MediaPlayer, MediaRecorder, MediaRelay
import cv2
from fastapi import FastAPI, Request, Response, status, Body
from fastapi.middleware.cors import CORSMiddleware
import numpy as np

import json
import uuid


app = FastAPI()
pcs = set()
relay = MediaRelay()
record_to = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VideoStreamTrack(VideoStreamTrack):

    kind = 'video'

    def __init__(self, track):
        super().__init__()  # don't forget this!
        self._counter = 0
        self._track = track

    async def recv(self):
        print(f'recv called {self._counter}')
        self._counter += 1
        frame_recv = await self._track.recv()
        img = (255 * np.random.rand(500, 500, 3)).astype(np.uint8)
        cv2.putText(
            img,
            text=f'image from server {self._counter}',
            org=(50, 50),
            fontFace=cv2.FONT_HERSHEY_SIMPLEX,
            fontScale=1.0,
            color=(0, 0, 0),
            thickness=2,
            # lineType=cv2.LINE_4
        )
        frame = VideoFrame.from_ndarray(img, format='bgr24')
        frame.pts = frame_recv.pts
        frame.time_base = frame_recv.time_base
        return frame


@app.post('/offer')
async def offer(request: Request, sdp: str = Body(...), typ: str = Body(...)):
# async def offer(request: Request):
    print('offer')
    offer = RTCSessionDescription(sdp=sdp, type=typ)

    pc = RTCPeerConnection()
    pc_id = 'PeerConnection(%s)' % uuid.uuid4()
    pcs.add(pc)

    print('Created for %s', request.client.host)

    # prepare local media
    # audio_player = MediaPlayer('/path/to/some/audio.wav')
    audio_player = None
    if record_to:
        recorder = MediaRecorder(record_to)
    else:
        recorder = MediaBlackhole()

    @pc.on('datachannel')
    def on_datachannel(channel):
        @channel.on('message')
        def on_message(message):
            if isinstance(message, str) and message.startswith('ping'):
                channel.send('pong' + message[4:])

    @pc.on('connectionstatechange')
    async def on_connectionstatechange():
        print('Connection state is %s', pc.connectionState)
        if pc.connectionState == 'failed':
            await pc.close()
            pcs.discard(pc)

    @pc.on('track')
    def on_track(track):
        print('Track %s received', track.kind)

        if track.kind == 'audio':
            if audio_player is not None:
                pc.addTrack(audio_player.audio)
            recorder.addTrack(track)
        elif track.kind == 'video':
            pc.addTrack(VideoStreamTrack(track=relay.subscribe(track)))
            if record_to:
                recorder.addTrack(relay.subscribe(track))

        @track.on('ended')
        async def on_ended():
            print('Track %s ended', track.kind)
            await recorder.stop()

    # handle offer
    await pc.setRemoteDescription(offer)
    await recorder.start()

    # send answer
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    data = json.dumps(
        {'sdp': pc.localDescription.sdp, 'type': pc.localDescription.type}
    )
    return Response(content=data, media_type='application/json', status_code=status.HTTP_200_OK)
