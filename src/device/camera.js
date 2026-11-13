export function createCamera(video, onChange) {
  let stream;
  let facing = 'environment';
  let generation = 0;

  function stop() {
    generation++;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    onChange(false);
  }

  async function start(requestedFacing = 'environment') {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera benötigt HTTPS oder localhost.');
    stop();
    const request = generation;
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {facingMode: {ideal: requestedFacing}, width: {ideal: 1280}, height: {ideal: 720}},
    });
    if (request !== generation) {
      next.getTracks().forEach(track => track.stop());
      return;
    }
    stream = next;
    const track = stream.getVideoTracks()[0];
    facing = track.getSettings().facingMode || requestedFacing;
    video.srcObject = stream;
    track.addEventListener('ended', () => { if (stream === next) stop(); });
    try {
      await video.play();
      if (stream === next) onChange(true);
    } catch (error) {
      if (stream === next) {
        stop();
        throw error;
      }
    }
  }
  return {start, stop, get active() { return Boolean(stream); }, get facing() { return facing; }};
}
