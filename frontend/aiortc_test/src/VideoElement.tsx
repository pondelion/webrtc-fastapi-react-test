type Props = {
  id: string,
}

const VideoElement = (props: Props) => {
  return (
    <video id={props.id} autoPlay={true} playsInline={true} style={{"backgroundColor": "red"}}></video>
  )
}

export default VideoElement;
  