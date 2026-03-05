function createScene(element) {
  // Renderer
  var renderer = new THREE.WebGLRenderer({
    clearColor: 0x000000,
    clearAlpha: 1,
  });
  renderer.setSize(element.width(), element.height());
  element.append(renderer.domElement);
  renderer.clear();

  // Scene
  var scene = new THREE.Scene();

  // Lights...
  [
    [0, 0, 1, 0xffffcc],
    [0, 1, 0, 0xffccff],
    [1, 0, 0, 0xccffff],
    [0, 0, -1, 0xccccff],
    [0, -1, 0, 0xccffcc],
    [-1, 0, 0, 0xffcccc],
  ].forEach(function (position) {
    var light = new THREE.DirectionalLight(position[3]);
    light.position.set(position[0], position[1], position[2]).normalize();
    scene.add(light);
  });

  // Camera...
  var fov = 45,
    aspect = element.width() / element.height(),
    near = 1,
    far = 10000,
    camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  //camera.rotationAutoUpdate = true;
  //camera.position.x = 0;
  //camera.position.y = 500;
  camera.position.z = 300;
  //camera.lookAt(scene.position);
  scene.add(camera);
  controls = new THREE.TrackballControls(camera);
  controls.noPan = true;
  controls.dynamicDampingFactor = 0.15;

  // Action!
  function render() {
    controls.update();
    renderer.render(scene, camera);

    requestAnimationFrame(render); // And repeat...
  }
  render();

  // Fix coordinates up if window is resized.
  $(window).on('resize', function () {
    renderer.setSize(element.width(), element.height());
    camera.aspect = element.width() / element.height();
    camera.updateProjectionMatrix();
    controls.screen.width = window.innerWidth;
    controls.screen.height = window.innerHeight;
  });

  return scene;
}
