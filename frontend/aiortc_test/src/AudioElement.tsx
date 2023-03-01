type Props = {
  id: string,
}

const AudioElement = (props: Props) => {
  return (
    <audio id={props.id} autoPlay={true}></audio>
  )
}

export default AudioElement;
