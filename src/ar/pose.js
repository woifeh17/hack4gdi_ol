// Vertrag für alternative Pose-Provider: WGS84-Position und Kamerabasis in Ost/Nord/Oben.
// Ein Zug-Provider kann später ENU←Zug und Zug←Kamera zusammensetzen.
export function createPoseProvider(position, orientation) {
  return {
    getFrame(options) {
      return {position: position.current, camera: orientation.getPose(options)};
    },
  };
}
